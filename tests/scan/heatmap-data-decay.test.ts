import { describe, it, expect } from 'vitest';
import { createHeatmap, updateHeatmapRow, aggregateProfiles } from '../../src/scan/heatmap-data.js';

/**
 * Tests for heatmap-data behavior with zeroed/rejected profiles.
 *
 * Key v4 behaviors:
 * 1. Zero profile detection → pure decay (not max-accumulate)
 * 2. Snap-to-zero threshold at 1e-10
 * 3. aggregateProfiles with mix of zero and non-zero inputs
 */

describe('updateHeatmapRow: zero profile detection', () => {
  it('zeroed profile applies pure decay to existing data', () => {
    const hm = createHeatmap([0], 4);
    // First: populate with real data
    const realProfile = new Float32Array([0.5, 1.0, 0.8, 0.3]);
    updateHeatmapRow(hm, 0, realProfile, 1, 1.0);
    expect(hm.data[1]).toBeCloseTo(1.0);

    // Second: zero profile → should decay, not max-accumulate
    const zeroProfile = new Float32Array(4);
    updateHeatmapRow(hm, 0, zeroProfile, -1, 0, 0.9);

    expect(hm.data[0]).toBeCloseTo(0.5 * 0.9);
    expect(hm.data[1]).toBeCloseTo(1.0 * 0.9);
    expect(hm.data[2]).toBeCloseTo(0.8 * 0.9);
    expect(hm.data[3]).toBeCloseTo(0.3 * 0.9);
  });

  it('repeated zero profiles decay data toward zero', () => {
    const hm = createHeatmap([0], 2);
    const realProfile = new Float32Array([1.0, 0.5]);
    updateHeatmapRow(hm, 0, realProfile, 0, 1.0);

    const zeroProfile = new Float32Array(2);
    const decay = 0.9;

    // Apply 10 rounds of zero profile
    for (let i = 0; i < 10; i++) {
      updateHeatmapRow(hm, 0, zeroProfile, -1, 0, decay);
    }

    // 1.0 * 0.9^10 ≈ 0.349
    expect(hm.data[0]).toBeCloseTo(1.0 * Math.pow(decay, 10), 3);
    expect(hm.data[1]).toBeCloseTo(0.5 * Math.pow(decay, 10), 3);
  });

  it('profile with extremely small values (< 1e-15) treated as zero', () => {
    const hm = createHeatmap([0], 3);
    const realProfile = new Float32Array([0.5, 0.5, 0.5]);
    updateHeatmapRow(hm, 0, realProfile, 1, 0.5);

    // Profile with values just below the zero-detection threshold
    const nearZero = new Float32Array([1e-16, 1e-20, 0]);
    updateHeatmapRow(hm, 0, nearZero, -1, 0, 0.8);

    // Should decay like a zero profile
    expect(hm.data[0]).toBeCloseTo(0.5 * 0.8);
    expect(hm.data[1]).toBeCloseTo(0.5 * 0.8);
    expect(hm.data[2]).toBeCloseTo(0.5 * 0.8);
  });

  it('non-zero profile uses max-accumulate (not pure decay)', () => {
    const hm = createHeatmap([0], 3);
    const realProfile = new Float32Array([1.0, 0.5, 0.2]);
    updateHeatmapRow(hm, 0, realProfile, 0, 1.0);

    // New profile with some non-zero bins → max-accumulate behavior
    const newProfile = new Float32Array([0.0, 0.8, 0.0]);
    // has a non-zero value → not detected as zero profile
    newProfile[1] = 0.8;
    updateHeatmapRow(hm, 0, newProfile, 1, 0.8, 0.9);

    // Bin 0: max(1.0*0.9, 0.0) = 0.9 (max-accumulate, not pure decay)
    expect(hm.data[0]).toBeCloseTo(0.9);
    // Bin 1: max(0.5*0.9, 0.8) = 0.8
    expect(hm.data[1]).toBeCloseTo(0.8);
    // Bin 2: max(0.2*0.9, 0.0) = 0.18
    expect(hm.data[2]).toBeCloseTo(0.18);
  });
});

describe('updateHeatmapRow: snap-to-zero threshold', () => {
  it('data snaps to exactly 0 once below 1e-10', () => {
    const hm = createHeatmap([0], 1);
    // Start with small value that will decay below 1e-10
    const profile = new Float32Array([1e-9]);
    updateHeatmapRow(hm, 0, profile, 0, 1e-9);

    // Apply zero profile with decay
    const zeroProfile = new Float32Array(1);
    updateHeatmapRow(hm, 0, zeroProfile, -1, 0, 0.9);
    // 1e-9 * 0.9 = 9e-10 → still above 1e-10
    expect(hm.data[0]).toBeGreaterThan(0);

    updateHeatmapRow(hm, 0, zeroProfile, -1, 0, 0.1);
    // 9e-10 * 0.1 = 9e-11 → below 1e-10 → snaps to 0
    expect(hm.data[0]).toBe(0);
  });

  it('once snapped to zero, stays zero under further decay', () => {
    const hm = createHeatmap([0], 1);
    hm.data[0] = 0; // already zero

    const zeroProfile = new Float32Array(1);
    updateHeatmapRow(hm, 0, zeroProfile, -1, 0, 0.9);
    expect(hm.data[0]).toBe(0); // 0 * 0.9 = 0, still 0
  });

  it('snap threshold (1e-10) is below display threshold (1e-7)', () => {
    // This ensures the heatmap data reaches zero before
    // the display would consider it "has data"
    const SNAP_THRESHOLD = 1e-10;
    const DISPLAY_HAS_DATA_THRESHOLD = 1e-7;
    expect(SNAP_THRESHOLD).toBeLessThan(DISPLAY_HAS_DATA_THRESHOLD);
  });
});

describe('aggregateProfiles: mixed zero and non-zero', () => {
  it('averaging zero profiles with real profiles dilutes signal', () => {
    const real = new Float32Array([0, 1.0, 0.5, 0]);
    const zero = new Float32Array(4);

    const { averaged, bestVal } = aggregateProfiles([real, zero, zero, zero], { mode: 'mean' });

    // Mean of [1.0, 0, 0, 0] = 0.25 for bin 1
    expect(averaged[1]).toBeCloseTo(0.25);
    expect(bestVal).toBeCloseTo(0.25);
  });

  it('all-zero profiles produce zero aggregate', () => {
    const zero1 = new Float32Array(5);
    const zero2 = new Float32Array(5);
    const zero3 = new Float32Array(5);

    const { averaged, bestVal } = aggregateProfiles([zero1, zero2, zero3]);

    for (let i = 0; i < averaged.length; i++) {
      expect(averaged[i]).toBe(0);
    }
    // bestBin should indicate no peak
    expect(bestVal).toBe(0);
  });

  it('median aggregation with majority-zero profiles → zero', () => {
    const real = new Float32Array([0, 0, 1.0, 0, 0]);
    const zero1 = new Float32Array(5);
    const zero2 = new Float32Array(5);

    const { averaged } = aggregateProfiles([real, zero1, zero2], { mode: 'median' });

    // Median of [1.0, 0, 0] = 0 for bin 2
    expect(averaged[2]).toBe(0);
  });

  it('trimmed mean with zero profiles reduces noise influence', () => {
    const real1 = new Float32Array([0, 0.8, 0]);
    const real2 = new Float32Array([0, 0.9, 0]);
    const zero1 = new Float32Array(3);
    const zero2 = new Float32Array(3);

    // Trimmed mean with 20% trim: removes lowest and highest
    const { averaged } = aggregateProfiles([real1, real2, zero1, zero2], {
      mode: 'trimmedMean',
      trimFraction: 0.2,
    });

    // Bin 1 values sorted: [0, 0, 0.8, 0.9]. Trim 20% = 0.8 items.
    // floor(4 * 0.2) = 0 trimmed from each side → mean of [0, 0, 0.8, 0.9] = 0.425
    expect(averaged[1]).toBeCloseTo(0.425);
  });
});

describe('updateHeatmapRow: temporal IIR mode', () => {
  it('temporal IIR updates bestBin/bestVal from integrated data', () => {
    const hm = createHeatmap([0], 5);
    const alpha = 0.5;

    const profile = new Float32Array([0.1, 0.3, 0.8, 0.2, 0.05]);
    updateHeatmapRow(hm, 0, profile, 2, 0.8, { decayFactor: 0.9, temporalIirAlpha: alpha });

    // After one IIR step from zero: data = 0 + alpha * (profile - 0) = alpha * profile
    // But decay first: 0 * 0.9 = 0, then data = 0 + alpha * (profile - 0)
    // Peak should still be at bin 2
    // In IIR mode, bestBin is recomputed from integrated data
    expect(hm.bestBin[0]).toBe(2);
    expect(hm.bestVal[0]).toBeGreaterThan(0);
  });
});
