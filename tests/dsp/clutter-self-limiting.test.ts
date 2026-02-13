import {
  applyEnvBaseline,
  suppressStaticReflections,
  evaluateSubtractionGuard,
} from '../../src/dsp/clutter.js';

describe('subtraction self-limiting', () => {
  it('flags heavy collapse and peak drop', () => {
    const before = new Float32Array([0.9, 1.0, 0.8, 0.7]);
    const after = new Float32Array([0.01, 0.02, 0.01, 0.01]);
    const guard = evaluateSubtractionGuard(before, after, {
      enabled: true,
      collapseThreshold: 0.3,
      peakDropThreshold: 0.4,
    });

    expect(guard.shouldBackoff).toBe(true);
    expect(guard.collapseRatio).toBeLessThan(0.3);
    expect(guard.peakRetention).toBeLessThan(0.4);
  });

  it('backs off env baseline subtraction when profile collapses', () => {
    const profile = new Float32Array([0.2, 0.5, 0.2]);
    const baseline = new Float32Array([1.0, 1.0, 1.0]);

    const out = applyEnvBaseline(profile, baseline, 1.0, {
      enabled: true,
      collapseThreshold: 0.25,
      peakDropThreshold: 0.35,
    });

    expect(out[1]).toBeGreaterThan(0.1);
  });

  it('backs off clutter suppression and avoids over-learning during collapse', () => {
    const profile = new Float32Array([0.2, 0.35, 0.2]);
    const state = { model: new Float32Array([1.0, 1.0, 1.0]) };

    const out = suppressStaticReflections(profile, state, 1.0, {
      backoff: {
        enabled: true,
        collapseThreshold: 0.25,
        peakDropThreshold: 0.35,
      },
      selectiveUpdate: { enabled: true, noveltyRatio: 0.3 },
    });

    expect(out.profile[1]).toBeGreaterThan(0.1);
    expect(out.clutterState.model).toBe(state.model);
  });
});
