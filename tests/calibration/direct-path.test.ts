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

  // Gaussian tau0 lock tests
  it('prefers peak near prediction over equally strong distant peak', () => {
    const sr = 48000;
    const corr = new Float32Array(sr * 0.06); // 60ms
    // Two peaks of equal strength
    const nearSample = 300;
    const farSample = 2500;
    corr[nearSample] = 0.8;
    corr[farSample] = 0.8;

    // Predict near the near peak
    const tau = findDirectPathTau(corr, nearSample / sr, 0.5, sr);
    // Should find the peak near our prediction
    expect(Math.abs(tau - nearSample / sr)).toBeLessThan(20 / sr);
  });

  it('still finds much stronger nearby peak', () => {
    const sr = 48000;
    const corr = new Float32Array(sr * 0.06);
    // Strong peak near prediction, weak peak far away
    const nearSample = 400;
    const farSample = 2200;
    corr[nearSample] = 1.0;
    corr[farSample] = 0.2;

    // Predict slightly off from the strong peak
    const predictedTau = (nearSample + 20) / sr;
    const tau = findDirectPathTau(corr, predictedTau, 0.5, sr);
    // Should find the strong nearby peak
    expect(Math.abs(tau - nearSample / sr)).toBeLessThan(30 / sr);
  });

  it('high lockStrength ignores distant strong peak', () => {
    const sr = 48000;
    const corr = new Float32Array(sr * 0.06);
    // sigma at lockStrength=0.95: 0.003 + 0.013*(1-0.95) = 0.003 + 0.00065 = 0.00365s
    // 3*sigma = 0.01095s => 0.01095 * 48000 = 525.6 samples search radius
    const nearSample = 500;
    const farSample = 2000; // well beyond 3*sigma from nearSample
    corr[nearSample] = 0.3;
    corr[farSample] = 1.0;

    const tau = findDirectPathTau(corr, nearSample / sr, 0.95, sr);
    // With high lock strength, sigma is very small, so the distant peak at 2000
    // is well outside the search window. Should find the near peak.
    expect(Math.abs(tau - nearSample / sr)).toBeLessThan(30 / sr);
  });

  it('smooth transition: no discontinuity as lock varies 0.1 to 0.9', () => {
    const sr = 48000;
    const corr = new Float32Array(sr * 0.06);
    // Single peak
    const peakSample = 600;
    corr[peakSample] = 1.0;

    // Sweep lockStrength from 0.1 to 0.9 and verify tau values change smoothly
    const taus: number[] = [];
    for (let ls = 0.1; ls <= 0.9; ls += 0.1) {
      const tau = findDirectPathTau(corr, peakSample / sr, ls, sr);
      taus.push(tau);
    }

    // All tau values should be near the peak (single peak scenario)
    for (const tau of taus) {
      expect(Math.abs(tau - peakSample / sr)).toBeLessThan(5 / sr);
    }

    // Check smoothness: difference between consecutive taus should be small
    for (let i = 1; i < taus.length; i++) {
      const diff = Math.abs(taus[i] - taus[i - 1]);
      // No large jumps; diff should be at most a few samples
      expect(diff).toBeLessThan(10 / sr);
    }
  });

  it('falls back to global when local weighted peak < 10% of global', () => {
    const sr = 48000;
    const corr = new Float32Array(sr * 0.06);
    // Strong global peak
    const globalPeakSample = 1500;
    corr[globalPeakSample] = 1.0;

    // Very weak peak near predicted location
    const localSample = 400;
    corr[localSample] = 0.05; // < 10% of global peak (1.0)

    // Predict near the weak local peak
    const tau = findDirectPathTau(corr, localSample / sr, 0.5, sr);
    // The local weighted peak abs value (0.05) < 0.1 * global abs peak (1.0) = 0.1
    // So it should fall back to the global peak
    expect(Math.abs(tau - globalPeakSample / sr)).toBeLessThan(5 / sr);
  });
});
