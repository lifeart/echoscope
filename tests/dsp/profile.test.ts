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

  it('returns zeroed profile when minR >= maxR', () => {
    const prof = buildRangeProfileFromCorrelation(
      new Float32Array(1000), 0, 343, 4.0, 4.0, 48000, 240,
    );
    expect(prof.every(v => v === 0)).toBe(true);
  });

  it('correctly applies tau0 offset', () => {
    const sr = 48000;
    const c = 343;
    const minR = 0.3;
    const maxR = 4.0;
    const bins = 240;

    // Target at 1.5 m
    const targetRange = 1.5;
    const targetTau = (2 * targetRange) / c; // round-trip time
    const tau0 = 0.003; // 3ms system delay offset
    const targetSample = Math.round((targetTau + tau0) * sr);

    const corr = new Float32Array(sr * 0.1);
    corr[targetSample] = 1.0;

    const prof = buildRangeProfileFromCorrelation(corr, tau0, c, minR, maxR, sr, bins);

    let maxBin = 0, maxVal = -Infinity;
    for (let i = 0; i < prof.length; i++) {
      if (prof[i] > maxVal) { maxVal = prof[i]; maxBin = i; }
    }

    const expectedBin = Math.floor(((targetRange - minR) / (maxR - minR)) * (bins - 1));
    expect(Math.abs(maxBin - expectedBin)).toBeLessThan(3);
    expect(maxVal).toBeCloseTo(1.0);
  });

  it('uses absolute values of correlation', () => {
    const sr = 48000;
    const c = 343;
    const minR = 0.3;
    const maxR = 4.0;
    const bins = 240;

    const targetRange = 2.0;
    const targetTau = (2 * targetRange) / c;
    const targetSample = Math.round(targetTau * sr);

    const corr = new Float32Array(sr * 0.1);
    corr[targetSample] = -0.8; // negative peak

    const prof = buildRangeProfileFromCorrelation(corr, 0, c, minR, maxR, sr, bins);

    let maxVal = -Infinity;
    for (let i = 0; i < prof.length; i++) {
      if (prof[i] > maxVal) maxVal = prof[i];
    }
    expect(maxVal).toBeCloseTo(0.8);
  });

  it('multiple targets map to separate bins', () => {
    const sr = 48000;
    const c = 343;
    const minR = 0.3;
    const maxR = 4.0;
    const bins = 240;

    const range1 = 1.0;
    const range2 = 3.0;
    const sample1 = Math.round((2 * range1 / c) * sr);
    const sample2 = Math.round((2 * range2 / c) * sr);

    const corr = new Float32Array(sr * 0.1);
    corr[sample1] = 0.7;
    corr[sample2] = 0.9;

    const prof = buildRangeProfileFromCorrelation(corr, 0, c, minR, maxR, sr, bins);

    const bin1 = Math.floor(((range1 - minR) / (maxR - minR)) * (bins - 1));
    const bin2 = Math.floor(((range2 - minR) / (maxR - minR)) * (bins - 1));

    // Both bins should have nonzero values
    expect(prof[bin1]).toBeGreaterThan(0);
    expect(prof[bin2]).toBeGreaterThan(0);
    // They should be in different locations
    expect(Math.abs(bin1 - bin2)).toBeGreaterThan(10);
  });

  it('ignores correlation samples outside range window', () => {
    const sr = 48000;
    const c = 343;
    const minR = 1.0;
    const maxR = 2.0;
    const bins = 100;

    // Place peak at range 0.5 (below minR)
    const sample = Math.round((2 * 0.5 / c) * sr);
    const corr = new Float32Array(sr * 0.1);
    corr[sample] = 1.0;

    const prof = buildRangeProfileFromCorrelation(corr, 0, c, minR, maxR, sr, bins);
    expect(prof.every(v => v === 0)).toBe(true);
  });
});
