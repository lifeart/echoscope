/**
 * Regression tests for fix #3/#11: unified median implementation.
 *
 * Before the fix, there were 4+ copies of median() across the codebase,
 * two of which mutated their input array (confidence.ts, heatmap-data.ts).
 * All are now replaced with the safe median() from utils.ts.
 */
import { describe, it, expect } from 'vitest';
import { median } from '../../src/utils.js';

describe('unified median', () => {
  it('returns 0 for empty array', () => {
    expect(median([])).toBe(0);
  });

  it('returns single element for length-1 array', () => {
    expect(median([42])).toBe(42);
  });

  it('returns middle for odd-length array', () => {
    expect(median([1, 3, 2])).toBe(2);
    expect(median([5, 1, 9, 3, 7])).toBe(5);
  });

  it('returns average of two middles for even-length array', () => {
    expect(median([1, 3, 2, 4])).toBe(2.5);
    expect(median([10, 20])).toBe(15);
  });

  it('does NOT mutate the input array', () => {
    const input = [3, 1, 4, 1, 5];
    const copy = input.slice();
    median(input);
    expect(input).toEqual(copy); // unchanged
  });

  it('handles negative values', () => {
    expect(median([-5, -1, -3])).toBe(-3);
  });

  it('handles duplicates', () => {
    expect(median([2, 2, 2])).toBe(2);
    expect(median([1, 2, 2, 3])).toBe(2);
  });
});
