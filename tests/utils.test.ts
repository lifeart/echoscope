import { clamp, signalEnergy, energyNormalize, median, mad } from '../src/utils.js';

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps to min when below range', () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });

  it('clamps to max when above range', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('returns min when min equals max', () => {
    expect(clamp(5, 3, 3)).toBe(3);
  });

  it('handles negative range', () => {
    expect(clamp(-5, -10, -1)).toBe(-5);
    expect(clamp(0, -10, -1)).toBe(-1);
    expect(clamp(-20, -10, -1)).toBe(-10);
  });
});

describe('signalEnergy', () => {
  it('returns sum of squared samples', () => {
    const a = new Float32Array([1, 2, 3]);
    expect(signalEnergy(a)).toBeCloseTo(14); // 1+4+9
  });

  it('returns 0 for empty array', () => {
    expect(signalEnergy(new Float32Array(0))).toBe(0);
  });

  it('handles negative values', () => {
    const a = new Float32Array([-2, 3]);
    expect(signalEnergy(a)).toBeCloseTo(13); // 4+9
  });

  it('returns 0 for all-zero array', () => {
    expect(signalEnergy(new Float32Array(4))).toBe(0);
  });
});

describe('energyNormalize', () => {
  it('divides each sample by refEnergy in place', () => {
    const corr = new Float32Array([10, 20, 30]);
    energyNormalize(corr, 10);
    expect(corr[0]).toBeCloseTo(1);
    expect(corr[1]).toBeCloseTo(2);
    expect(corr[2]).toBeCloseTo(3);
  });

  it('does nothing when refEnergy is near zero', () => {
    const corr = new Float32Array([1, 2, 3]);
    const before = Float32Array.from(corr);
    energyNormalize(corr, 1e-13);
    expect(corr[0]).toBe(before[0]);
    expect(corr[1]).toBe(before[1]);
    expect(corr[2]).toBe(before[2]);
  });

  it('handles empty array without error', () => {
    const corr = new Float32Array(0);
    expect(() => energyNormalize(corr, 10)).not.toThrow();
  });
});

describe('median', () => {
  it('returns middle value for odd-length array', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('returns average of two middle values for even-length array', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('returns 0 for empty array', () => {
    expect(median([])).toBe(0);
  });

  it('returns the single element for length-1 array', () => {
    expect(median([42])).toBe(42);
  });

  it('filters out non-finite values', () => {
    expect(median([1, NaN, 3, Infinity, 2])).toBe(2);
  });

  it('returns 0 when all values are non-finite', () => {
    expect(median([NaN, Infinity, -Infinity])).toBe(0);
  });

  it('handles negative values', () => {
    expect(median([-5, -1, -3])).toBe(-3);
  });
});

describe('mad', () => {
  it('returns median absolute deviation from given median', () => {
    // values: [1, 2, 3, 4, 5], med = 3
    // deviations: [2, 1, 0, 1, 2]
    // median of deviations: 1
    expect(mad([1, 2, 3, 4, 5], 3)).toBe(1);
  });

  it('returns 0 for single-element array', () => {
    expect(mad([5], 5)).toBe(0);
  });

  it('returns 0 for identical values', () => {
    expect(mad([3, 3, 3], 3)).toBe(0);
  });

  it('filters out non-finite values', () => {
    expect(mad([1, NaN, 3, 5], 3)).toBe(2);
  });

  it('returns 0 for empty array', () => {
    expect(mad([], 0)).toBe(0);
  });
});
