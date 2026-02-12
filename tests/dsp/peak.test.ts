import { findPeak, findPeakAbs, estimateBestFromProfile } from '../../src/dsp/peak.js';

describe('findPeak', () => {
  it('finds maximum value', () => {
    const a = new Float32Array([1, 3, 2, 5, 4]);
    const result = findPeak(a);
    expect(result.index).toBe(3);
    expect(result.value).toBe(5);
  });

  it('respects range', () => {
    const a = new Float32Array([1, 3, 2, 5, 4]);
    const result = findPeak(a, 0, 3);
    expect(result.index).toBe(1);
    expect(result.value).toBe(3);
  });
});

describe('findPeakAbs', () => {
  it('finds absolute maximum', () => {
    const a = new Float32Array([1, -5, 3, 2]);
    const result = findPeakAbs(a);
    expect(result.index).toBe(1);
    expect(result.absValue).toBe(5);
    expect(result.value).toBe(-5);
  });
});

describe('estimateBestFromProfile', () => {
  it('returns NaN range for zero profile', () => {
    const prof = new Float32Array(10);
    const result = estimateBestFromProfile(prof, 0.3, 4.0);
    expect(result.bin).toBe(-1);
    expect(Number.isNaN(result.range)).toBe(true);
  });

  it('returns valid range for nonzero profile', () => {
    const prof = new Float32Array(240);
    prof[120] = 0.8;
    const result = estimateBestFromProfile(prof, 0.3, 4.0);
    expect(result.bin).toBe(120);
    expect(result.range).toBeGreaterThan(0.3);
    expect(result.range).toBeLessThan(4.0);
  });
});
