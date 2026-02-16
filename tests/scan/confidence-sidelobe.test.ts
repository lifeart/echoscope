/**
 * Tests for Fix #12: Confidence sidelobe ratio log-scale mapping.
 *
 * Verifies that the sidelobe ratio contribution to confidence uses
 * log10 mapping instead of linear, maintaining sensitivity across
 * the full dynamic range.
 */
import { describe, it, expect } from 'vitest';
import { computeProfileConfidence } from '../../src/scan/confidence.js';

function makeProfile(peakBin: number, peakVal: number, floorVal: number, len = 64): Float32Array {
  const p = new Float32Array(len);
  for (let i = 0; i < len; i++) p[i] = floorVal;
  p[peakBin] = peakVal;
  return p;
}

describe('confidence sidelobe ratio log mapping', () => {
  it('returns valid metrics for a clear peak', () => {
    const profile = makeProfile(32, 1.0, 0.01);
    const metrics = computeProfileConfidence(profile, 32, 1.0);

    expect(metrics.psr).toBeGreaterThan(1);
    expect(metrics.sharpness).toBeGreaterThanOrEqual(0);
    expect(metrics.sidelobeRatio).toBeGreaterThan(0);
    expect(metrics.confidence).toBeGreaterThan(0);
    expect(metrics.confidence).toBeLessThanOrEqual(1);
  });

  it('higher sidelobe ratio gives higher confidence', () => {
    // Profile with modest sidelobe ratio
    const p1 = makeProfile(32, 1.0, 0.3);
    const m1 = computeProfileConfidence(p1, 32, 1.0);

    // Profile with much better sidelobe ratio
    const p2 = makeProfile(32, 1.0, 0.01);
    const m2 = computeProfileConfidence(p2, 32, 1.0);

    expect(m2.sidelobeRatio).toBeGreaterThan(m1.sidelobeRatio);
    expect(m2.confidence).toBeGreaterThan(m1.confidence);
  });

  it('log mapping does not saturate at moderate ratios', () => {
    // With linear mapping, sidelobe ratio saturated at ~3.4
    // With log10, ratio=10 → log10(10)/3 = 0.33, ratio=100 → 0.67, ratio=1000 → 1.0
    // So there's still room to distinguish between 10, 100, and 1000

    const p10 = makeProfile(32, 1.0, 0.1, 100);
    const p100 = makeProfile(32, 1.0, 0.01, 100);
    const p1000 = makeProfile(32, 1.0, 0.001, 100);

    const m10 = computeProfileConfidence(p10, 32, 1.0);
    const m100 = computeProfileConfidence(p100, 32, 1.0);
    const m1000 = computeProfileConfidence(p1000, 32, 1.0);

    // Each should be distinct
    expect(m1000.confidence).toBeGreaterThan(m100.confidence);
    expect(m100.confidence).toBeGreaterThan(m10.confidence);
  });

  it('returns zero confidence for empty/invalid input', () => {
    const empty = computeProfileConfidence(new Float32Array(0), 0, 1.0);
    expect(empty.confidence).toBe(0);

    const negBin = computeProfileConfidence(new Float32Array(10), -1, 1.0);
    expect(negBin.confidence).toBe(0);

    const zeroVal = computeProfileConfidence(new Float32Array(10), 5, 0);
    expect(zeroVal.confidence).toBe(0);
  });

  it('sidelobeRatio uses energy-based computation', () => {
    const profile = makeProfile(32, 1.0, 0.05);
    const metrics = computeProfileConfidence(profile, 32, 1.0);

    // The sidelobe ratio is mainEnergy / sideEnergy
    // Main lobe: bins 31-33, Side: everything else
    const mainE = profile[31] ** 2 + profile[32] ** 2 + profile[33] ** 2;
    const sideE = Array.from(profile).reduce((s, v, i) =>
      Math.abs(i - 32) > 1 ? s + v * v : s, 0);
    const expected = mainE / Math.max(1e-12, sideE);

    expect(metrics.sidelobeRatio).toBeCloseTo(expected, 4);
  });
});
