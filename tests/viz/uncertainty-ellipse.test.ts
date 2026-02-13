import { describe, it, expect } from 'vitest';
import { positionCovarianceUF, covarianceToEllipse } from '../../src/viz/uncertainty-ellipse.js';

/**
 * Helper: create a 4x4 covariance matrix (row-major Float64Array) with specified
 * position-block values. Off-diagonal blocks (velocity) are zero.
 */
function makeCov4x4(varRange: number, covRangeAngle: number, varAngle: number): Float64Array {
  const cov = new Float64Array(16);
  cov[0] = varRange;           // [0,0] = var(range)
  cov[1] = covRangeAngle;      // [0,1] = cov(range, angle)
  cov[4] = covRangeAngle;      // [1,0] = cov(angle, range) (symmetric)
  cov[5] = varAngle;           // [1,1] = var(angle)
  return cov;
}

describe('positionCovarianceUF', () => {
  it('at angle=0 maps range var to sigFF, angle var to sigUU', () => {
    // At angle=0: sin=0, cos=1
    // Jacobian J = [[0, range*1], [1, 0]]
    // So: sigUU = 0 * varR + range^2 * varA_rad
    //     sigFF = 1 * varR + 0
    //     sigUF = 0
    const range = 3.0;
    const varRange = 0.04;   // (0.2m)^2
    const varAngle = 4.0;    // (2 deg)^2
    const cov = makeCov4x4(varRange, 0, varAngle);

    const { sigUU, sigFF, sigUF } = positionCovarianceUF(range, 0, cov);

    const degToRad = Math.PI / 180;
    const varAngle_rad = varAngle * degToRad * degToRad;

    // sigFF should be dominated by range variance
    expect(sigFF).toBeCloseTo(varRange, 6);
    // sigUU should be range^2 * angle variance (in rad)
    expect(sigUU).toBeCloseTo(range * range * varAngle_rad, 6);
    // sigUF should be ~0 (no cross-correlation when angle=0 and covRangeAngle=0)
    expect(Math.abs(sigUF)).toBeLessThan(1e-10);
  });

  it('at 45 degrees mixes range and angle', () => {
    const range = 2.0;
    const cov = makeCov4x4(0.01, 0, 1.0);

    const { sigUU, sigFF } = positionCovarianceUF(range, 45, cov);

    // At 45 deg, sin=cos=sqrt(2)/2, both sigUU and sigFF get contributions from both
    expect(sigUU).toBeGreaterThan(0);
    expect(sigFF).toBeGreaterThan(0);
    // With diagonal covariance (no range-angle cross-term), sigUF might still be
    // nonzero because the Jacobian mixes the terms
  });

  it('diagonal covariance at 0 degrees gives sigUF = 0', () => {
    const range = 5.0;
    const cov = makeCov4x4(0.1, 0, 2.0);

    const { sigUF } = positionCovarianceUF(range, 0, cov);
    expect(Math.abs(sigUF)).toBeLessThan(1e-10);
  });

  it('diagonal covariance at 90 degrees gives sigUF = 0', () => {
    const range = 5.0;
    const cov = makeCov4x4(0.1, 0, 2.0);

    const { sigUF } = positionCovarianceUF(range, 90, cov);
    expect(Math.abs(sigUF)).toBeLessThan(1e-10);
  });

  it('non-zero cov(range,angle) produces non-zero sigUF at generic angles', () => {
    const range = 3.0;
    const cov = makeCov4x4(0.04, 0.5, 4.0);

    const { sigUF } = positionCovarianceUF(range, 30, cov);
    expect(Math.abs(sigUF)).toBeGreaterThan(0);
  });
});

describe('covarianceToEllipse', () => {
  it('equal variances and zero cross-covariance gives circle', () => {
    const sigma = 0.5;
    const { semiMajor, semiMinor } = covarianceToEllipse(sigma, sigma, 0);

    expect(semiMajor).toBeCloseTo(semiMinor, 6);
  });

  it('rotation is nonzero when sigUF is nonzero', () => {
    const { rotationRad } = covarianceToEllipse(2.0, 1.0, 0.5);
    expect(Math.abs(rotationRad)).toBeGreaterThan(0);
  });

  it('rotation is zero when sigUF is zero and variances differ', () => {
    const { rotationRad } = covarianceToEllipse(2.0, 1.0, 0);
    expect(rotationRad).toBeCloseTo(0, 10);
  });

  it('k=1 gives smaller ellipse than default k=2.146', () => {
    const sigUU = 1.0, sigFF = 0.5, sigUF = 0.1;
    const defaultEllipse = covarianceToEllipse(sigUU, sigFF, sigUF);
    const oneSigma = covarianceToEllipse(sigUU, sigFF, sigUF, 1.0);

    expect(oneSigma.semiMajor).toBeLessThan(defaultEllipse.semiMajor);
    expect(oneSigma.semiMinor).toBeLessThan(defaultEllipse.semiMinor);
  });

  it('semiMajor is always >= semiMinor', () => {
    const cases = [
      { sigUU: 3.0, sigFF: 0.1, sigUF: 0 },
      { sigUU: 0.1, sigFF: 3.0, sigUF: 0 },
      { sigUU: 1.0, sigFF: 1.0, sigUF: 0.5 },
      { sigUU: 2.0, sigFF: 0.5, sigUF: -0.3 },
    ];
    for (const { sigUU, sigFF, sigUF } of cases) {
      const { semiMajor, semiMinor } = covarianceToEllipse(sigUU, sigFF, sigUF);
      expect(semiMajor).toBeGreaterThanOrEqual(semiMinor - 1e-12);
    }
  });

  it('handles near-zero variances without crashing', () => {
    const { semiMajor, semiMinor, rotationRad } = covarianceToEllipse(1e-15, 1e-15, 0);
    expect(Number.isFinite(semiMajor)).toBe(true);
    expect(Number.isFinite(semiMinor)).toBe(true);
    expect(Number.isFinite(rotationRad)).toBe(true);
    expect(semiMajor).toBeGreaterThanOrEqual(0);
    expect(semiMinor).toBeGreaterThanOrEqual(0);
  });

  it('handles zero variances without crashing', () => {
    const { semiMajor, semiMinor } = covarianceToEllipse(0, 0, 0);
    expect(semiMajor).toBe(0);
    expect(semiMinor).toBe(0);
  });

  it('isotropic covariance + non-square pixel scale gives elongated ellipse', () => {
    // Isotropic covariance in meter space: sigUU = sigFF, sigUF = 0
    const sigma = 1.0;
    // Non-square pixel scale: 100 px/m in U, 50 px/m in F
    const pxPerMeterU = 100;
    const pxPerMeterF = 50;

    // Scale covariance to pixel space
    const sigUUpx = sigma * pxPerMeterU * pxPerMeterU;
    const sigFFpx = sigma * pxPerMeterF * pxPerMeterF;
    const sigUFpx = 0;

    const ellipse = covarianceToEllipse(sigUUpx, sigFFpx, sigUFpx, 1.0);

    // With non-square pixel scaling, the "circle" in meter space becomes an ellipse
    // semiMajor should be larger than semiMinor
    expect(ellipse.semiMajor).toBeGreaterThan(ellipse.semiMinor);
    // The ratio should reflect the pixel scale ratio
    expect(ellipse.semiMajor / ellipse.semiMinor).toBeCloseTo(pxPerMeterU / pxPerMeterF, 1);
  });

  it('rotated covariance in non-square pixel space has different rotation than meter space', () => {
    // Covariance in meter space with off-diagonal term
    const sigUU = 2.0;
    const sigFF = 1.0;
    const sigUF = 0.5;

    // Meter space ellipse
    const meterEllipse = covarianceToEllipse(sigUU, sigFF, sigUF, 1.0);

    // Non-square pixel scale
    const pxPerMeterU = 100;
    const pxPerMeterF = 50;
    const sigUUpx = sigUU * pxPerMeterU * pxPerMeterU;
    const sigFFpx = sigFF * pxPerMeterF * pxPerMeterF;
    const sigUFpx = sigUF * pxPerMeterU * pxPerMeterF;

    const pixelEllipse = covarianceToEllipse(sigUUpx, sigFFpx, sigUFpx, 1.0);

    // With asymmetric pixel scale, the rotation in pixel space should differ
    // from the rotation in meter space (unless perfectly axis-aligned)
    expect(pixelEllipse.rotationRad).not.toBeCloseTo(meterEllipse.rotationRad, 2);
  });
});
