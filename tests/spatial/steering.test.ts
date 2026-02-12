import { computeSteeringDelay } from '../../src/spatial/steering.js';

describe('computeSteeringDelay', () => {
  it('returns 0 for 0 degrees', () => {
    expect(computeSteeringDelay(0, 0.2, 343)).toBeCloseTo(0, 10);
  });

  it('returns positive delay for positive angle', () => {
    const dt = computeSteeringDelay(30, 0.2, 343);
    expect(dt).toBeGreaterThan(0);
  });

  it('returns negative delay for negative angle', () => {
    const dt = computeSteeringDelay(-30, 0.2, 343);
    expect(dt).toBeLessThan(0);
  });

  it('delay is symmetric', () => {
    const dt1 = computeSteeringDelay(30, 0.2, 343);
    const dt2 = computeSteeringDelay(-30, 0.2, 343);
    expect(Math.abs(dt1 + dt2)).toBeLessThan(1e-10);
  });
});
