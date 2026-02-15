/**
 * Regression tests for fix #3/#11: unified median implementation.
 *
 * Before the fix, there were 4+ copies of median() across the codebase,
 * two of which mutated their input array (confidence.ts, heatmap-data.ts).
 * All are now replaced with the safe median() from utils.ts.
 */
import { describe, it, expect } from 'vitest';
import { median, mad } from '../../src/utils.js';

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

  it('filters out NaN values and computes median of remaining', () => {
    expect(median([NaN])).toBe(0);
    expect(median([1, NaN, 3])).toBe(2);
    expect(median([NaN, NaN, NaN])).toBe(0);
    expect(median([5, NaN, 1, NaN, 9])).toBe(5);
  });

  it('filters out Infinity / -Infinity values', () => {
    expect(median([Infinity])).toBe(0);
    expect(median([-Infinity])).toBe(0);
    expect(median([1, Infinity, 3])).toBe(2);
    expect(median([-Infinity, 2, 4, Infinity])).toBe(3);
  });

  it('handles already-sorted input', () => {
    expect(median([1, 2, 3, 4, 5])).toBe(3);
  });

  it('handles all-identical even-length array', () => {
    expect(median([5, 5, 5, 5])).toBe(5);
  });

  it('handles large array (100+ elements)', () => {
    const arr = Array.from({ length: 101 }, (_, i) => i);
    expect(median(arr)).toBe(50);
    const even = Array.from({ length: 100 }, (_, i) => i);
    expect(median(even)).toBe(49.5);
  });
});

describe('mad (median absolute deviation)', () => {
  it('returns 0 for empty array', () => {
    expect(mad([], 0)).toBe(0);
  });

  it('returns 0 for constant array', () => {
    expect(mad([5, 5, 5], 5)).toBe(0);
  });

  it('computes correct MAD for simple case', () => {
    // arr = [1, 2, 3, 4, 5], median = 3
    // deviations = [2, 1, 0, 1, 2] → sorted: [0, 1, 1, 2, 2] → median = 1
    expect(mad([1, 2, 3, 4, 5], 3)).toBe(1);
  });

  it('handles NaN in input', () => {
    expect(mad([1, NaN, 3], 2)).toBe(1);
  });

  it('computes MAD for asymmetric distribution', () => {
    // arr = [1, 2, 3, 10], median = 2.5
    // deviations = [1.5, 0.5, 0.5, 7.5] → sorted: [0.5, 0.5, 1.5, 7.5] → median = 1
    expect(mad([1, 2, 3, 10], 2.5)).toBe(1);
  });
});
