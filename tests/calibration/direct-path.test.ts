import { findDirectPathTau } from '../../src/calibration/direct-path.js';

describe('findDirectPathTau', () => {
  it('finds peak in early window with no prediction', () => {
    const sr = 48000;
    const corr = new Float32Array(sr * 0.1); // 100ms
    const peakSample = 500;
    corr[peakSample] = 1.0;

    const tau = findDirectPathTau(corr, null, 0, sr);
    expect(Math.abs(tau - peakSample / sr)).toBeLessThan(1 / sr);
  });

  it('locks to predicted tau when lockStrength > 0', () => {
    const sr = 48000;
    const corr = new Float32Array(sr * 0.1);
    // Two peaks: one at 200, one at 2000 (far apart)
    corr[200] = 0.5;
    corr[2000] = 1.0;

    // Without lock, should find the stronger peak at 2000
    const tau1 = findDirectPathTau(corr, null, 0, sr);
    expect(Math.abs(tau1 - 2000 / sr)).toBeLessThan(1 / sr);

    // With lock near 200, window excludes 2000, should find peak near 200
    const tau2 = findDirectPathTau(corr, 200 / sr, 0.8, sr);
    expect(Math.abs(tau2 - 200 / sr)).toBeLessThan(10 / sr);
  });
});
