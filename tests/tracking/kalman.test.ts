import { createTarget, predict, update } from '../../src/tracking/kalman.js';
import type { Measurement } from '../../src/types.js';

describe('Kalman filter', () => {
  it('creates target from measurement', () => {
    const meas: Measurement = { range: 2.0, angleDeg: 30, strength: 0.8, timestamp: 0 };
    const target = createTarget(1, meas);
    expect(target.position.range).toBe(2.0);
    expect(target.position.angleDeg).toBe(30);
    expect(target.velocity.rangeRate).toBe(0);
  });

  it('predicts constant velocity', () => {
    const meas: Measurement = { range: 2.0, angleDeg: 0, strength: 0.8, timestamp: 0 };
    let target = createTarget(1, meas);
    target.velocity.rangeRate = 0.5; // 0.5 m/s

    const predicted = predict(target, 1.0); // 1 second
    expect(predicted.position.range).toBeCloseTo(2.5, 1);
  });

  it('updates towards measurement', () => {
    const meas: Measurement = { range: 2.0, angleDeg: 0, strength: 0.8, timestamp: 0 };
    let target = createTarget(1, meas);

    const newMeas: Measurement = { range: 2.5, angleDeg: 5, strength: 0.9, timestamp: 1 };
    target = predict(target, 1.0);
    target = update(target, newMeas);

    // Should move towards measurement
    expect(target.position.range).toBeGreaterThan(2.0);
    expect(target.position.range).toBeLessThanOrEqual(2.5);
    expect(target.missCount).toBe(0);
  });

  it('handles non-finite or negative dt safely in predict', () => {
    const meas: Measurement = { range: 2.0, angleDeg: 10, strength: 0.8, timestamp: 0 };
    let target = createTarget(1, meas);
    target.velocity.rangeRate = 0.7;
    target.velocity.angleRate = -3;

    const predictedNaN = predict(target, Number.NaN);
    expect(predictedNaN.position.range).toBeCloseTo(2.0, 6);
    expect(predictedNaN.position.angleDeg).toBeCloseTo(10, 6);
    expect(Array.from(predictedNaN.covariance).every(Number.isFinite)).toBe(true);

    const predictedNeg = predict(target, -1);
    expect(predictedNeg.position.range).toBeCloseTo(2.0, 6);
    expect(predictedNeg.position.angleDeg).toBeCloseTo(10, 6);
    expect(Array.from(predictedNeg.covariance).every(Number.isFinite)).toBe(true);
  });
});
