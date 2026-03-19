import { describe, it, expect } from 'vitest';
import { cfarAlpha, caCfar, applyCfarFilter } from '../../src/dsp/cfar.js';

describe('cfarAlpha', () => {
  it('returns correct multiplier for known Pfa/N', () => {
    // Formula: alpha = N * (Pfa^(-1/N) - 1)
    // N=16, Pfa=1e-3 => 16 * ((1e-3)^(-1/16) - 1)
    const N = 16;
    const pfa = 1e-3;
    const expected = N * (Math.pow(pfa, -1 / N) - 1);
    const result = cfarAlpha(N, pfa);
    expect(result).toBeCloseTo(expected, 10);
    // Sanity: alpha should be positive and greater than 1 for small Pfa
    expect(result).toBeGreaterThan(1);
  });

  it('returns 1 for invalid inputs', () => {
    expect(cfarAlpha(0, 0.01)).toBe(1);
    expect(cfarAlpha(-1, 0.01)).toBe(1);
    expect(cfarAlpha(10, 0)).toBe(1);
    expect(cfarAlpha(10, 1)).toBe(1);
    expect(cfarAlpha(10, -0.5)).toBe(1);
  });

  it('increases with lower Pfa (stricter threshold)', () => {
    const a1 = cfarAlpha(16, 1e-2);
    const a2 = cfarAlpha(16, 1e-4);
    expect(a2).toBeGreaterThan(a1);
  });
});

describe('caCfar', () => {
  it('detects single strong peak above noise', () => {
    const len = 100;
    const profile = new Float32Array(len);
    // Uniform noise at 0.01
    for (let i = 0; i < len; i++) profile[i] = 0.01;
    // Single strong peak
    profile[50] = 1.0;

    const result = caCfar(profile);
    expect(result.detections[50]).toBe(1);
    expect(result.detectionCount).toBeGreaterThanOrEqual(1);
  });

  it('rejects peak below noise floor', () => {
    const len = 100;
    const profile = new Float32Array(len);
    // Uniform noise at 0.5
    for (let i = 0; i < len; i++) profile[i] = 0.5;
    // Peak at same level as noise
    profile[50] = 0.5;

    const result = caCfar(profile);
    // A value equal to the noise floor should not be detected
    expect(result.detections[50]).toBe(0);
  });

  it('handles edge cells correctly', () => {
    const len = 50;
    const profile = new Float32Array(len);
    for (let i = 0; i < len; i++) profile[i] = 0.001;
    // Peak at index 0
    profile[0] = 1.0;
    // Peak at last index
    profile[len - 1] = 1.0;

    const result = caCfar(profile);
    // Edge bins are skipped (alpha assumes full 2*train cells; incomplete
    // windows would produce incorrect thresholds), so no detection at edges.
    expect(result.detections[0]).toBe(0);
    expect(result.detections[len - 1]).toBe(0);
    // Thresholds at edges are Infinity (suppressed — prevents false CFAR pass)
    expect(result.thresholds[0]).toBe(Infinity);
    expect(result.thresholds[len - 1]).toBe(Infinity);
  });

  it('detects two separated peaks', () => {
    const len = 200;
    const profile = new Float32Array(len);
    for (let i = 0; i < len; i++) profile[i] = 0.001;
    // Two peaks at opposite ends
    profile[20] = 1.0;
    profile[180] = 0.8;

    const result = caCfar(profile);
    expect(result.detections[20]).toBe(1);
    expect(result.detections[180]).toBe(1);
    expect(result.detectionCount).toBeGreaterThanOrEqual(2);
  });

  it('guard cells prevent self-masking', () => {
    const len = 100;
    const profile = new Float32Array(len);
    for (let i = 0; i < len; i++) profile[i] = 0.001;
    // Peak with high neighbors that are within guard cell distance
    profile[50] = 1.0;
    profile[49] = 0.8;
    profile[51] = 0.8;

    // Use guard cells = 2 (default), so neighbors at +/-1 are within guard zone
    // and shouldn't raise the threshold for cell 50
    const result = caCfar(profile, { guardCells: 2 });
    expect(result.detections[50]).toBe(1);
  });

  it('zero detections for uniform noise', () => {
    const len = 100;
    const profile = new Float32Array(len);
    for (let i = 0; i < len; i++) profile[i] = 0.5;

    const result = caCfar(profile);
    expect(result.detectionCount).toBe(0);
    for (let i = 0; i < len; i++) {
      expect(result.detections[i]).toBe(0);
    }
  });

  it('empty profile returns empty result', () => {
    const profile = new Float32Array(0);
    const result = caCfar(profile);
    expect(result.thresholds.length).toBe(0);
    expect(result.detections.length).toBe(0);
    expect(result.detectionCount).toBe(0);
  });

  it('thresholds array has same length as profile', () => {
    const len = 64;
    const profile = new Float32Array(len);
    for (let i = 0; i < len; i++) profile[i] = Math.random() * 0.01;
    profile[32] = 1.0;

    const result = caCfar(profile);
    expect(result.thresholds.length).toBe(len);
    expect(result.detections.length).toBe(len);
  });

  it('respects custom config parameters', () => {
    const len = 100;
    const profile = new Float32Array(len);
    for (let i = 0; i < len; i++) profile[i] = 0.01;
    profile[50] = 0.05;

    // Very permissive Pfa should detect more
    const permissive = caCfar(profile, { pfa: 0.5, guardCells: 1, trainingCells: 4 });
    // Very strict Pfa should detect fewer
    const strict = caCfar(profile, { pfa: 1e-6, guardCells: 1, trainingCells: 4 });

    expect(permissive.detectionCount).toBeGreaterThanOrEqual(strict.detectionCount);
  });
});

describe('applyCfarFilter', () => {
  it('zeros non-detected bins and preserves detected bins', () => {
    const len = 100;
    const profile = new Float32Array(len);
    for (let i = 0; i < len; i++) profile[i] = 0.01;
    profile[50] = 1.0;

    const { filtered, result } = applyCfarFilter(profile);

    for (let i = 0; i < len; i++) {
      if (result.detections[i]) {
        expect(filtered[i]).toBe(profile[i]);
      } else {
        expect(filtered[i]).toBe(0);
      }
    }
  });

  it('does not modify the original profile', () => {
    const len = 50;
    const profile = new Float32Array(len);
    for (let i = 0; i < len; i++) profile[i] = 0.02;
    profile[25] = 1.0;
    const originalCopy = new Float32Array(profile);

    applyCfarFilter(profile);

    for (let i = 0; i < len; i++) {
      expect(profile[i]).toBe(originalCopy[i]);
    }
  });

  it('returns all zeros for uniform profile', () => {
    const len = 60;
    const profile = new Float32Array(len);
    for (let i = 0; i < len; i++) profile[i] = 0.1;

    const { filtered } = applyCfarFilter(profile);
    for (let i = 0; i < len; i++) {
      expect(filtered[i]).toBe(0);
    }
  });
});
