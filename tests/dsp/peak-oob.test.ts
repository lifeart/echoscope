import { findPeak, findPeakAbs } from '../../src/dsp/peak.js';

/**
 * Regression test: findPeak and findPeakAbs must never return an index
 * that is out of bounds (>= array.length).
 *
 * When the search range is empty or invalid (start >= end, or start >=
 * array.length), the functions clamp start but may still return
 * index === array.length, which is OOB.
 */
describe('findPeak OOB index', () => {
  it('returns in-bounds index when start >= array length', () => {
    const a = new Float32Array([1, 2, 3]);
    const result = findPeak(a, 10, 20);
    expect(result.index).toBeLessThan(a.length);
    expect(result.index).toBeGreaterThanOrEqual(0);
  });

  it('returns in-bounds index when start === array length', () => {
    const a = new Float32Array([1, 2, 3]);
    const result = findPeak(a, 3, 3);
    expect(result.index).toBeLessThan(a.length);
  });

  it('returns in-bounds index for empty array with default range', () => {
    const a = new Float32Array(0);
    const result = findPeak(a);
    // For empty array, index 0 is already OOB but there's nothing to access
    // The key invariant: index < a.length or a.length === 0
    expect(result.value).toBe(0);
  });

  it('returns in-bounds index when start === end', () => {
    const a = new Float32Array([5, 10, 15]);
    const result = findPeak(a, 2, 2);
    // Empty range: should not return index 2 (valid but degenerate)
    // or should return a sensible fallback
    expect(result.index).toBeLessThan(a.length);
  });
});

describe('findPeakAbs OOB index', () => {
  it('returns in-bounds index when start >= array length', () => {
    const a = new Float32Array([1, 2, 3]);
    const result = findPeakAbs(a, 10, 20);
    expect(result.index).toBeLessThan(a.length);
    expect(result.index).toBeGreaterThanOrEqual(0);
  });

  it('returns in-bounds index when start === array length', () => {
    const a = new Float32Array([1, -2, 3]);
    const result = findPeakAbs(a, 3, 5);
    expect(result.index).toBeLessThan(a.length);
  });

  it('returns in-bounds index when end < start', () => {
    const a = new Float32Array([1, 2, 3, 4, 5]);
    // After clamping, start=3, end=clamp(2,3,5)=3, so e<=s
    const result = findPeakAbs(a, 3, 2);
    expect(result.index).toBeLessThan(a.length);
  });
});
