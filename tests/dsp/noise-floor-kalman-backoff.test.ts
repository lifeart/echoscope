import { createNoiseKalmanState, guardBackoff, subtractNoiseFloor } from '../../src/dsp/noise-floor-kalman.js';

describe('noise-floor-kalman backoff', () => {
  it('backs off when subtraction collapses profile too aggressively', () => {
    const state = createNoiseKalmanState(4, 1.0);
    const raw = new Float32Array([0.15, 0.22, 0.16, 0.14]);
    const cleaned = subtractNoiseFloor(raw, state, 1.0, 0, 1);

    const out = guardBackoff(raw, cleaned, {
      enabled: true,
      collapseThreshold: 0.25,
      peakDropThreshold: 0.35,
    });

    expect(out.backoffLevel).toBeGreaterThan(0);
    expect(out.profile[1]).toBeGreaterThan(0.1);
  });

  it('keeps cleaned profile when guard conditions are healthy', () => {
    const state = createNoiseKalmanState(4, 0.2);
    const raw = new Float32Array([0.2, 0.45, 0.25, 0.2]);
    const cleaned = subtractNoiseFloor(raw, state, 0.3, 0, 1);

    const out = guardBackoff(raw, cleaned, {
      enabled: true,
      collapseThreshold: 0.15,
      peakDropThreshold: 0.15,
    });

    expect(out.backoffLevel).toBe(0);
    expect(out.profile[1]).toBeCloseTo(cleaned[1], 8);
  });
});
