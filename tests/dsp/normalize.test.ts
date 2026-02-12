import { absMaxNormalize, peakNormalize, toDecibels } from '../../src/dsp/normalize.js';

describe('absMaxNormalize', () => {
  it('normalizes so max absolute value is 1', () => {
    const a = new Float32Array([0.2, -0.5, 0.3]);
    absMaxNormalize(a);
    expect(Math.max(...Array.from(a).map(Math.abs))).toBeCloseTo(1.0);
    expect(a[1]).toBeCloseTo(-1.0); // was the abs max
  });

  it('handles all-positive values', () => {
    const a = new Float32Array([0.1, 0.4, 0.2]);
    absMaxNormalize(a);
    expect(a[1]).toBeCloseTo(1.0);
    expect(a[0]).toBeCloseTo(0.25);
  });

  it('handles all-negative values', () => {
    const a = new Float32Array([-0.2, -0.8, -0.4]);
    absMaxNormalize(a);
    expect(a[1]).toBeCloseTo(-1.0);
    expect(a[0]).toBeCloseTo(-0.25);
  });

  it('returns unchanged for near-zero array', () => {
    const a = new Float32Array([1e-15, -1e-15]);
    const original = new Float32Array(a);
    absMaxNormalize(a);
    expect(a[0]).toBe(original[0]);
    expect(a[1]).toBe(original[1]);
  });

  it('modifies array in place and returns it', () => {
    const a = new Float32Array([0.5, 1.0]);
    const result = absMaxNormalize(a);
    expect(result).toBe(a);
  });

  it('handles single element', () => {
    const a = new Float32Array([0.3]);
    absMaxNormalize(a);
    expect(a[0]).toBeCloseTo(1.0);
  });
});

describe('peakNormalize', () => {
  it('normalizes so max value is 1', () => {
    const a = new Float32Array([0.2, 0.5, 0.3]);
    peakNormalize(a);
    expect(a[1]).toBeCloseTo(1.0);
    expect(a[0]).toBeCloseTo(0.4);
  });

  it('ignores negative values for peak finding', () => {
    const a = new Float32Array([-2, 0.5, 0.3]);
    peakNormalize(a);
    // Peak is 0.5, so scale factor is 1/0.5 = 2
    expect(a[0]).toBeCloseTo(-4.0); // -2 * 2
    expect(a[1]).toBeCloseTo(1.0);
  });

  it('returns unchanged for near-zero array', () => {
    const a = new Float32Array([0, 0, 0]);
    peakNormalize(a);
    expect(a[0]).toBe(0);
  });
});

describe('toDecibels', () => {
  it('returns 0 dB for reference value', () => {
    expect(toDecibels(1.0)).toBeCloseTo(0);
  });

  it('returns -20 dB for 0.1', () => {
    expect(toDecibels(0.1)).toBeCloseTo(-20);
  });

  it('returns +20 dB for 10', () => {
    expect(toDecibels(10)).toBeCloseTo(20);
  });

  it('returns -Infinity for zero', () => {
    expect(toDecibels(0)).toBe(-Infinity);
  });

  it('returns -Infinity for negative', () => {
    expect(toDecibels(-1)).toBe(-Infinity);
  });

  it('respects custom reference', () => {
    expect(toDecibels(2, 2)).toBeCloseTo(0);
    expect(toDecibels(4, 2)).toBeCloseTo(6.02, 1);
  });
});
