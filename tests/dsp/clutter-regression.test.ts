import { applyEnvBaseline } from '../../src/dsp/clutter.js';

/**
 * Regression tests for envBaseline zeroing out weak signals.
 *
 * Bug: When the env baseline (recorded during calibration) has values
 * larger than the actual ping profile, applyEnvBaseline subtracts
 * everything to zero, leaving the heatmap completely blank.
 */
describe('applyEnvBaseline regression', () => {
  it('zeroes out profile when baseline exceeds signal', () => {
    // Simulates the bug: signal ~1e-4, baseline ~5e-4
    const profile = new Float32Array([1e-4, 2e-4, 3e-5, 1.5e-4]);
    const baseline = new Float32Array([5e-4, 5e-4, 5e-4, 5e-4]);
    const result = applyEnvBaseline(profile, baseline, 0.55);

    // All bins zeroed: profile[i] - 0.55 * baseline[i] < 0 for all i
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBe(0);
    }
  });

  it('preserves signal that exceeds baseline', () => {
    const profile = new Float32Array([1e-3, 2e-3, 5e-4, 1e-3]);
    const baseline = new Float32Array([1e-4, 1e-4, 1e-4, 1e-4]);
    const result = applyEnvBaseline(profile, baseline, 0.55);

    // Signal is much stronger than baseline: should preserve most of it
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBeGreaterThan(0);
    }
    // First bin: 1e-3 - 0.55 * 1e-4 = 1e-3 - 5.5e-5 ≈ 9.45e-4
    expect(result[0]).toBeCloseTo(9.45e-4, 6);
  });

  it('can detect when entire profile is zeroed (for fallback logic)', () => {
    const profile = new Float32Array([3e-5, 6e-5, 2e-5, 1e-5, 5e-5]);
    const baseline = new Float32Array([1e-3, 1e-3, 1e-3, 1e-3, 1e-3]);
    const result = applyEnvBaseline(profile, baseline, 1.0);

    // Check: is result entirely zero?
    let maxVal = 0;
    for (let i = 0; i < result.length; i++) {
      if (result[i] > maxVal) maxVal = result[i];
    }
    expect(maxVal).toBe(0);

    // The caller should fall back to the raw profile in this case
    let rawMax = 0;
    for (let i = 0; i < profile.length; i++) {
      if (profile[i] > rawMax) rawMax = profile[i];
    }
    expect(rawMax).toBeGreaterThan(0);
  });

  it('partially zeroes profile when some bins are above baseline', () => {
    const profile = new Float32Array([1e-4, 5e-3, 2e-5, 3e-3]);
    const baseline = new Float32Array([1e-3, 1e-3, 1e-3, 1e-3]);
    const result = applyEnvBaseline(profile, baseline, 0.55);

    // Bin 0: 1e-4 - 5.5e-4 < 0 → 0
    expect(result[0]).toBe(0);
    // Bin 1: 5e-3 - 5.5e-4 > 0 → preserved
    expect(result[1]).toBeGreaterThan(0);
    // Bin 2: 2e-5 - 5.5e-4 < 0 → 0
    expect(result[2]).toBe(0);
    // Bin 3: 3e-3 - 5.5e-4 > 0 → preserved
    expect(result[3]).toBeGreaterThan(0);
  });
});
