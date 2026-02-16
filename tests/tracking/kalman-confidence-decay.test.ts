/**
 * Tests for Fix #8: Kalman confidence decay on predict.
 *
 * Verifies that the confidence decays exponentially (×0.92 per step)
 * during prediction without measurement updates, preventing stale
 * tracks from retaining artificially high confidence.
 */
import { describe, it, expect } from 'vitest';
import { createTarget, predict, update } from '../../src/tracking/kalman.js';
import type { Measurement } from '../../src/types.js';

describe('Kalman confidence decay', () => {
  it('confidence decays by 0.92 per predict step', () => {
    const meas: Measurement = { range: 2.0, angleDeg: 0, strength: 0.8, timestamp: 0 };
    let target = createTarget(1, meas);
    expect(target.confidence).toBe(0.8);

    target = predict(target, 1.0);
    expect(target.confidence).toBeCloseTo(0.8 * 0.92, 6);

    target = predict(target, 1.0);
    expect(target.confidence).toBeCloseTo(0.8 * 0.92 * 0.92, 6);
  });

  it('confidence reaches near-zero after many predictions without update', () => {
    const meas: Measurement = { range: 2.0, angleDeg: 0, strength: 1.0, timestamp: 0 };
    let target = createTarget(1, meas);

    for (let i = 0; i < 50; i++) {
      target = predict(target, 0.1);
    }

    // 0.92^50 ≈ 0.0148
    expect(target.confidence).toBeLessThan(0.02);
    expect(target.confidence).toBeGreaterThan(0);
  });

  it('update restores confidence based on measurement', () => {
    const meas: Measurement = { range: 2.0, angleDeg: 0, strength: 0.9, timestamp: 0 };
    let target = createTarget(1, meas);

    // Let confidence decay
    for (let i = 0; i < 10; i++) {
      target = predict(target, 0.1);
    }
    const decayed = target.confidence;
    expect(decayed).toBeLessThan(0.9);

    // Update with a strong measurement
    const newMeas: Measurement = { range: 2.1, angleDeg: 1, strength: 0.95, timestamp: 1 };
    target = update(target, newMeas);

    // Update should boost confidence above the decayed value
    expect(target.confidence).toBeGreaterThan(decayed);
  });

  it('miss count increments on predict', () => {
    const meas: Measurement = { range: 2.0, angleDeg: 0, strength: 0.8, timestamp: 0 };
    let target = createTarget(1, meas);
    expect(target.missCount).toBe(0);

    target = predict(target, 1.0);
    expect(target.missCount).toBe(1);

    target = predict(target, 1.0);
    expect(target.missCount).toBe(2);
  });

  it('dt=0 still applies confidence decay', () => {
    const meas: Measurement = { range: 2.0, angleDeg: 0, strength: 0.8, timestamp: 0 };
    let target = createTarget(1, meas);

    // Even with dt=0, confidence should still decay
    // because the prediction step itself indicates a missed measurement
    target = predict(target, 0);
    expect(target.confidence).toBeCloseTo(0.8 * 0.92, 6);
  });
});
