import {
  createNoiseKalmanState,
  guardBackoff,
  subtractNoiseFloor,
  updateNoiseKalman,
} from '../../src/dsp/noise-floor-kalman.js';

describe('noise-floor-kalman', () => {
  it('converges to stationary noise floor', () => {
    const state = createNoiseKalmanState(8, 0);
    const measurement = new Float32Array(8).fill(0.2);

    for (let i = 0; i < 200; i++) {
      updateNoiseKalman(state, measurement, {
        q: 1e-5,
        r: 1e-3,
        minFloor: 0,
        maxFloor: 1,
      });
    }

    for (let i = 0; i < state.x.length; i++) {
      expect(state.x[i]).toBeGreaterThan(0.18);
      expect(state.x[i]).toBeLessThan(0.22);
    }
  });

  it('does not jump aggressively on single-bin transient spike', () => {
    const state = createNoiseKalmanState(6, 0);
    const baseline = new Float32Array(6).fill(0.15);

    for (let i = 0; i < 120; i++) {
      updateNoiseKalman(state, baseline, {
        q: 5e-6,
        r: 2e-3,
        minFloor: 0,
        maxFloor: 1,
      });
    }

    const before = state.x[2];
    const spiked = new Float32Array(baseline);
    spiked[2] = 1.0;
    updateNoiseKalman(state, spiked, {
      q: 5e-6,
      r: 2e-2,
      minFloor: 0,
      maxFloor: 1,
    });

    expect(state.x[2] - before).toBeLessThan(0.2);

    for (let i = 0; i < 20; i++) {
      updateNoiseKalman(state, baseline, {
        q: 5e-6,
        r: 2e-3,
        minFloor: 0,
        maxFloor: 1,
      });
    }

    expect(state.x[2]).toBeLessThan(0.35);
    expect(state.x[2]).toBeGreaterThan(0.1);
  });

  it('respects floor clamps in update and subtraction', () => {
    const state = createNoiseKalmanState(3, 0);
    updateNoiseKalman(state, new Float32Array([2, 2, 2]), {
      q: 1e-4,
      r: 1e-4,
      minFloor: 0,
      maxFloor: 0.4,
    });

    expect(state.x[0]).toBeLessThan(0.401);
    expect(state.x[1]).toBeLessThan(0.401);
    expect(state.x[2]).toBeLessThan(0.401);

    state.x[0] = 0.5;
    state.x[1] = 2.0;
    state.x[2] = -1.0;
    const out = subtractNoiseFloor(new Float32Array([0.6, 0.6, 0.6]), state, 1.0, 0, 1);

    expect(out[0]).toBeCloseTo(0.1, 4);
    expect(out[1]).toBeCloseTo(0.0, 4);
    expect(out[2]).toBeCloseTo(0.6, 4);
  });

  it('backs off subtraction when profile collapses', () => {
    const raw = new Float32Array([0.2, 0.5, 0.2]);
    const cleaned = new Float32Array([0, 0, 0]);

    const out = guardBackoff(raw, cleaned, {
      enabled: true,
      collapseThreshold: 0.25,
      peakDropThreshold: 0.35,
    });

    expect(out.backoffLevel).toBeGreaterThan(0);
    expect(out.profile[1]).toBeGreaterThan(0.1);

    const passThrough = guardBackoff(raw, cleaned, {
      enabled: false,
      collapseThreshold: 0.25,
      peakDropThreshold: 0.35,
    });
    expect(passThrough.profile).toBe(cleaned);
  });
});
