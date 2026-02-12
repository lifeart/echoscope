import { buildRangeProfileFromCorrelation } from '../../src/dsp/profile.js';

describe('buildRangeProfileFromCorrelation', () => {
  it('returns zeroed profile for empty correlation', () => {
    const prof = buildRangeProfileFromCorrelation(new Float32Array(0), 0, 343, 0.3, 4.0, 48000, 240);
    expect(prof.length).toBe(240);
    expect(prof.every(v => v === 0)).toBe(true);
  });

  it('maps correlation peaks to range bins', () => {
    const sr = 48000;
    const c = 343;
    const minR = 0.3;
    const maxR = 4.0;
    const tau0 = 0;
    const bins = 240;

    // Place a peak at a known range
    const targetRange = 2.0;
    const targetTau = (2 * targetRange) / c;
    const targetSample = Math.round((targetTau + tau0) * sr);

    const corr = new Float32Array(sr * 0.1); // 100ms of correlation
    if (targetSample < corr.length) {
      corr[targetSample] = 1.0;
    }

    const prof = buildRangeProfileFromCorrelation(corr, tau0, c, minR, maxR, sr, bins);
    // Find peak bin
    let maxBin = 0, maxVal = -Infinity;
    for (let i = 0; i < prof.length; i++) {
      if (prof[i] > maxVal) { maxVal = prof[i]; maxBin = i; }
    }

    // Verify peak is near expected range bin
    const expectedBin = Math.floor(((targetRange - minR) / (maxR - minR)) * (bins - 1));
    expect(Math.abs(maxBin - expectedBin)).toBeLessThan(3);
  });
});
