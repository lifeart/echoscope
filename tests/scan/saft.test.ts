import {
  apertureWeight,
  buildSaftHeatmap,
  coherentSumCell,
  computeExpectedTauShift,
  interpolateComplexAt,
} from '../../src/scan/saft.js';
import type { RawAngleFrame, SaftConfig } from '../../src/types.js';

function makeConfig(overrides?: Partial<SaftConfig>): SaftConfig {
  return {
    enabled: true,
    halfWindow: 2,
    window: 'hann',
    phaseCenterHz: 4000,
    coherenceFloor: 0,
    maxTauShiftSamples: 256,
    ...overrides,
  };
}

function fwhmDegrees(values: number[], angles: number[]): number {
  let peak = -Infinity;
  let peakIdx = -1;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > peak) {
      peak = values[i];
      peakIdx = i;
    }
  }
  if (peakIdx < 0 || peak <= 0) return 0;

  const half = 0.5 * peak;
  let left = peakIdx;
  while (left > 0 && values[left] >= half) left--;
  let right = peakIdx;
  while (right < values.length - 1 && values[right] >= half) right++;

  return Math.max(0, angles[right] - angles[left]);
}

describe('saft core', () => {
  it('interpolates complex values at fractional sample index', () => {
    const real = new Float32Array([0, 10]);
    const imag = new Float32Array([0, 4]);
    const out = interpolateComplexAt(real, imag, 0.25);

    expect(out.valid).toBe(true);
    expect(out.real).toBeCloseTo(2.5, 8);
    expect(out.imag).toBeCloseTo(1.0, 8);
  });

  it('tau shift is antisymmetric between target/source angle swap', () => {
    const a = computeExpectedTauShift(0, 12, 2.0, 0.2, 343);
    const b = computeExpectedTauShift(12, 0, 2.0, 0.2, 343);

    expect(a).toBeGreaterThan(0);
    expect(b).toBeLessThan(0);
    expect(a).toBeCloseTo(-b, 10);
  });

  it('window weighting behaves correctly at center and edge', () => {
    expect(apertureWeight(0, 3, 'hann')).toBeCloseTo(1, 10);
    expect(apertureWeight(3, 3, 'hann')).toBeCloseTo(0, 10);

    const g0 = apertureWeight(0, 3, 'gaussian');
    const g2 = apertureWeight(2, 3, 'gaussian');
    const g3 = apertureWeight(3, 3, 'gaussian');
    expect(g0).toBeGreaterThan(g2);
    expect(g2).toBeGreaterThan(g3);
    expect(g3).toBeGreaterThan(0);
  });

  it('phase compensation aligns coherent sum with expected sign', () => {
    const angles = [-6, 0, 6];
    const range = 0.02;
    const spacing = 0.2;
    const c = 343;
    const fc = 4500;
    const len = 128;

    const frames: RawAngleFrame[] = angles.map((angleDeg) => {
      const shift = computeExpectedTauShift(0, angleDeg, range, spacing, c);
      const phase = 2 * Math.PI * fc * shift;
      const real = new Float32Array(len);
      const imag = new Float32Array(len);
      const rv = Math.cos(phase);
      const iv = Math.sin(phase);
      for (let i = 0; i < len; i++) {
        real[i] = rv;
        imag[i] = iv;
      }

      return {
        angleDeg,
        sampleRate: 48000,
        tau0: 0,
        corrReal: real,
        corrImag: imag,
        centerFreqHz: fc,
        quality: 1,
      };
    });

    const out = coherentSumCell(
      1,
      range,
      frames,
      angles,
      makeConfig({ halfWindow: 1, phaseCenterHz: fc, coherenceFloor: 0 }),
      spacing,
      c,
    );

    expect(out.coherence).toBeGreaterThan(0.98);
    expect(out.intensity).toBeGreaterThan(0.95);
  });

  it('synthetic point-target narrows by at least 2x with SAFT window', () => {
    const angles: number[] = [];
    for (let a = -30; a <= 30; a += 3) angles.push(a);

    const minRange = 0.005;
    const maxRange = 0.06;
    const bins = 64;
    const spacing = 0.4;
    const speedOfSound = 343;
    const sampleRate = 48000;
    const tau0 = 0;
    const centerFreqHz = 18000;
    const corrLen = 256;

    const targetAngle = 0;
    const targetRange = 0.02;
    const targetBin = Math.round(((targetRange - minRange) / (maxRange - minRange)) * (bins - 1));

    const frames: RawAngleFrame[] = angles.map((angleDeg) => {
      const shift = computeExpectedTauShift(targetAngle, angleDeg, targetRange, spacing, speedOfSound);
      const phase = 2 * Math.PI * centerFreqHz * shift;

      const corrReal = new Float32Array(corrLen);
      const corrImag = new Float32Array(corrLen);
      const rv = Math.cos(phase);
      const iv = Math.sin(phase);
      for (let idx = 0; idx < corrLen; idx++) {
        corrReal[idx] = rv;
        corrImag[idx] = iv;
      }

      return {
        angleDeg,
        sampleRate,
        tau0,
        corrReal,
        corrImag,
        centerFreqHz,
        quality: 1,
      };
    });

    const baseline = buildSaftHeatmap({
      rawFrames: frames,
      scanAngles: angles,
      minRange,
      maxRange,
      bins,
      spacing,
      speedOfSound,
      config: makeConfig({ halfWindow: 0, coherenceFloor: 0 }),
    });

    const saft = buildSaftHeatmap({
      rawFrames: frames,
      scanAngles: angles,
      minRange,
      maxRange,
      bins,
      spacing,
      speedOfSound,
      config: makeConfig({ halfWindow: 4, window: 'hann', coherenceFloor: 0 }),
    });

    const baselineCuts = angles.map((_, row) => baseline.data[row * bins + targetBin]);
    const saftCuts = angles.map((_, row) => saft.data[row * bins + targetBin]);

    const baselineWidth = fwhmDegrees(baselineCuts, angles);
    const saftWidth = fwhmDegrees(saftCuts, angles);

    expect(baselineWidth).toBeGreaterThan(0);
    expect(saftWidth).toBeGreaterThan(0);
    expect(saftWidth).toBeLessThanOrEqual(0.5 * baselineWidth);
  });

  it('matches frames with slight angle jitter via tolerant lookup', () => {
    const angles = [-10, 0, 10];
    const range = 0.02;
    const spacing = 0.2;
    const c = 343;
    const len = 32;

    const frames: RawAngleFrame[] = angles.map((a) => ({
      angleDeg: a + 1e-3,
      sampleRate: 48000,
      tau0: 0,
      corrReal: new Float32Array(len).fill(1),
      corrImag: new Float32Array(len),
      centerFreqHz: 4000,
      quality: 1,
    }));

    const out = coherentSumCell(
      1,
      range,
      frames,
      angles,
      makeConfig({ halfWindow: 2, coherenceFloor: 0 }),
      spacing,
      c,
    );

    expect(out.intensity).toBeGreaterThan(0.1);
    expect(out.coherence).toBeGreaterThan(0.1);
  });

  it('down-weights low-quality conflicting rows during coherent accumulation', () => {
    const angles = [-10, 0, 10];
    const targetRow = 1;
    const targetAngle = angles[targetRow];
    const range = 0.02;
    const spacing = 0.2;
    const c = 343;
    const fc = 4000;
    const len = 32;

    function makeFrame(sourceAngle: number, desiredRotatedReal: number, quality: number): RawAngleFrame {
      const shift = computeExpectedTauShift(targetAngle, sourceAngle, range, spacing, c);
      const phase = -2 * Math.PI * fc * shift;
      const sampleReal = desiredRotatedReal * Math.cos(phase);
      const sampleImag = -desiredRotatedReal * Math.sin(phase);
      return {
        angleDeg: sourceAngle,
        sampleRate: 48000,
        tau0: 0,
        corrReal: new Float32Array(len).fill(sampleReal),
        corrImag: new Float32Array(len).fill(sampleImag),
        centerFreqHz: fc,
        quality,
      };
    }

    const baseFrames: RawAngleFrame[] = [
      makeFrame(-10, 1, 1),
      makeFrame(0, 1, 1),
      makeFrame(10, -1, 1),
    ];

    const lowQualityFrames: RawAngleFrame[] = [
      baseFrames[0],
      baseFrames[1],
      { ...baseFrames[2], quality: 0 },
    ];

    const fullQualityOut = coherentSumCell(
      targetRow,
      range,
      baseFrames,
      angles,
      makeConfig({ halfWindow: 2, window: 'hann', phaseCenterHz: fc, coherenceFloor: 0 }),
      spacing,
      c,
    );

    const lowQualityOut = coherentSumCell(
      targetRow,
      range,
      lowQualityFrames,
      angles,
      makeConfig({ halfWindow: 2, window: 'hann', phaseCenterHz: fc, coherenceFloor: 0 }),
      spacing,
      c,
    );

    expect(lowQualityOut.intensity).toBeGreaterThan(fullQualityOut.intensity);
  });
});
