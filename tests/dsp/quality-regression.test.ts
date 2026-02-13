import { applyQualityAlgorithms, adaptiveFloorSuppressProfile } from '../../src/dsp/quality.js';

/**
 * Regression tests for quality algorithms with weak signals.
 *
 * The quality pipeline (median → smooth → adaptiveFloor → smooth) can
 * reduce weak signals significantly. These tests verify that genuine
 * peaks survive quality processing even at small amplitudes.
 */
describe('quality algorithms with weak signals', () => {
  it('balanced mode preserves weak peak above noise', () => {
    const prof = new Float32Array(240);
    // Noise floor at ~1e-6, peak at ~2e-4
    for (let i = 0; i < 240; i++) prof[i] = 1e-6;
    prof[120] = 2e-4;
    prof[119] = 1e-4;
    prof[121] = 1e-4;

    const result = applyQualityAlgorithms(prof, 'balanced');

    // Peak should still be detectable (> noise floor)
    let maxVal = 0;
    for (let i = 0; i < result.length; i++) {
      if (result[i] > maxVal) maxVal = result[i];
    }
    expect(maxVal).toBeGreaterThan(1e-6);
  });

  it('max mode preserves isolated peak above local floor', () => {
    const prof = new Float32Array(240);
    // Low uniform noise, one strong-ish peak
    for (let i = 0; i < 240; i++) prof[i] = 1e-7;
    prof[100] = 5e-4;
    prof[99] = 2e-4;
    prof[101] = 2e-4;

    const result = applyQualityAlgorithms(prof, 'max');

    // The peak region should survive adaptive floor suppression
    let maxVal = 0, maxBin = -1;
    for (let i = 0; i < result.length; i++) {
      if (result[i] > maxVal) { maxVal = result[i]; maxBin = i; }
    }
    expect(maxVal).toBeGreaterThan(0);
    expect(maxBin).toBeGreaterThanOrEqual(98);
    expect(maxBin).toBeLessThanOrEqual(102);
  });

  it('max mode zeros flat profile (no real peak)', () => {
    const prof = new Float32Array(240);
    // Completely flat profile — all bins same value
    for (let i = 0; i < 240; i++) prof[i] = 1e-4;

    const result = applyQualityAlgorithms(prof, 'max');

    // Adaptive floor should remove flat signal (no peak above local average)
    let maxVal = 0;
    for (let i = 0; i < result.length; i++) {
      if (result[i] > maxVal) maxVal = result[i];
    }
    // Interior bins should be near zero (edges may differ slightly)
    // Check interior only (avoid edge effects)
    let interiorMax = 0;
    for (let i = 10; i < 230; i++) {
      if (result[i] > interiorMax) interiorMax = result[i];
    }
    expect(interiorMax).toBeLessThan(1e-5);
  });

  it('fast mode preserves all values unchanged', () => {
    const prof = new Float32Array([3e-5, 6e-5, 1e-5, 2e-5]);
    const result = applyQualityAlgorithms(prof, 'fast');

    for (let i = 0; i < prof.length; i++) {
      expect(result[i]).toBe(prof[i]);
    }
    // Should be a copy, not the same reference
    expect(result).not.toBe(prof);
  });
});

describe('adaptiveFloorSuppressProfile', () => {
  it('removes uniform background', () => {
    const prof = new Float32Array(20);
    for (let i = 0; i < 20; i++) prof[i] = 0.5;

    const result = adaptiveFloorSuppressProfile(prof);

    // All values should be near zero since signal = local average
    for (let i = 4; i < 16; i++) {
      expect(result[i]).toBeLessThan(0.1);
    }
  });

  it('preserves spike above background', () => {
    const prof = new Float32Array(20);
    for (let i = 0; i < 20; i++) prof[i] = 0.01;
    prof[10] = 1.0;

    const result = adaptiveFloorSuppressProfile(prof);

    // Spike should survive
    expect(result[10]).toBeGreaterThan(0.5);
  });
});
