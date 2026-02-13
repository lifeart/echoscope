import { buildRangeProfileFromCorrelation } from '../../src/dsp/profile.js';

/**
 * Regression tests for profile building with weak signals.
 *
 * Bug: The profile was all zeros because correlation values were very
 * small (~1e-5) after energy normalization. These tests verify that
 * even very weak correlation values produce non-zero profile bins.
 */
describe('buildRangeProfileFromCorrelation with weak signals', () => {
  const sr = 48000;
  const c = 343;
  const heatBins = 240;
  const minR = 0.3;
  const maxR = 4.0;

  function makeCorrelation(length: number, peakIndex: number, peakValue: number): Float32Array {
    const corr = new Float32Array(length);
    corr[peakIndex] = peakValue;
    return corr;
  }

  it('captures weak signal (~1e-5) at 1m range', () => {
    const tau0 = 0.010; // 10ms system delay
    const targetRange = 1.0;
    const targetTau = (2 * targetRange) / c; // round-trip time
    const sampleIdx = Math.round((tau0 + targetTau) * sr);

    const corr = makeCorrelation(6400, sampleIdx, 3e-5);
    const prof = buildRangeProfileFromCorrelation(corr, tau0, c, minR, maxR, sr, heatBins);

    // Profile should have a non-zero bin near range 1.0m
    let maxVal = 0, maxBin = -1;
    for (let b = 0; b < prof.length; b++) {
      if (prof[b] > maxVal) { maxVal = prof[b]; maxBin = b; }
    }

    // With triangular bin splatting, single sample energy is averaged across bins
    // so the peak value will be smaller than the raw correlation value
    expect(maxVal).toBeGreaterThan(0);
    expect(maxBin).toBeGreaterThanOrEqual(0);

    // Verify the bin maps to approximately 1.0m
    const binRange = minR + (maxBin / (heatBins - 1)) * (maxR - minR);
    expect(binRange).toBeCloseTo(targetRange, 0);
  });

  it('captures very weak signal (~1e-8) at 2m range', () => {
    const tau0 = 0.012;
    const targetRange = 2.0;
    const targetTau = (2 * targetRange) / c;
    const sampleIdx = Math.round((tau0 + targetTau) * sr);

    const corr = makeCorrelation(6400, sampleIdx, 1e-8);
    const prof = buildRangeProfileFromCorrelation(corr, tau0, c, minR, maxR, sr, heatBins);

    let maxVal = 0;
    for (let b = 0; b < prof.length; b++) {
      if (prof[b] > maxVal) maxVal = prof[b];
    }
    // With triangular bin splatting, single sample energy is averaged across bins
    expect(maxVal).toBeGreaterThan(0);
  });

  it('produces non-zero bins when correlation has noise in range window', () => {
    const tau0 = 0.010;
    const corr = new Float32Array(6400);

    // Add small noise in the range window
    const minTau = (2 * minR) / c;
    const maxTau = (2 * maxR) / c;
    const iMin = Math.ceil((tau0 + minTau) * sr);
    const iMax = Math.floor((tau0 + maxTau) * sr);

    for (let i = iMin; i <= iMax && i < corr.length; i++) {
      corr[i] = 1e-6 * Math.sin(i * 0.1); // tiny oscillating signal
    }

    const prof = buildRangeProfileFromCorrelation(corr, tau0, c, minR, maxR, sr, heatBins);

    let nonZero = 0;
    for (let b = 0; b < prof.length; b++) {
      if (prof[b] > 0) nonZero++;
    }
    // Should have captured at least some non-zero bins from the noise
    expect(nonZero).toBeGreaterThan(0);
  });

  it('produces all zeros when correlation is zero in range window', () => {
    const tau0 = 0.010;
    const corr = new Float32Array(6400);
    // Put signal OUTSIDE the range window
    corr[50] = 1.0; // well before the range window

    const prof = buildRangeProfileFromCorrelation(corr, tau0, c, minR, maxR, sr, heatBins);

    let maxVal = 0;
    for (let b = 0; b < prof.length; b++) {
      if (prof[b] > maxVal) maxVal = prof[b];
    }
    expect(maxVal).toBe(0);
  });
});
