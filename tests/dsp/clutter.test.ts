import {
  suppressStaticReflections,
  applyEnvBaseline,
  createClutterState,
} from '../../src/dsp/clutter.js';

describe('suppressStaticReflections', () => {
  it('returns profile unchanged on first call (empty model)', () => {
    const profile = new Float32Array([0.5, 0.8, 0.3]);
    const state = createClutterState();
    const result = suppressStaticReflections(profile, state, 1.0);
    // First call: model is all zeros, so nothing subtracted
    expect(result.profile[0]).toBeCloseTo(0.5);
    expect(result.profile[1]).toBeCloseTo(0.8);
    expect(result.profile[2]).toBeCloseTo(0.3);
  });

  it('learns and subtracts static background over time', () => {
    let state = createClutterState();
    const staticProfile = new Float32Array([0.5, 0.5, 0.5]);

    // Feed the same static profile multiple times
    for (let i = 0; i < 50; i++) {
      const result = suppressStaticReflections(staticProfile, state, 1.0);
      state = result.clutterState;
    }

    // After many iterations, the model converges to staticProfile
    // So suppression should reduce values significantly
    const final = suppressStaticReflections(staticProfile, state, 1.0);
    for (let i = 0; i < final.profile.length; i++) {
      expect(final.profile[i]).toBeLessThan(0.1);
    }
  });

  it('preserves dynamic targets above static floor', () => {
    let state = createClutterState();
    const staticProfile = new Float32Array([0.3, 0.3, 0.3]);

    // Train model on static profile
    for (let i = 0; i < 50; i++) {
      const result = suppressStaticReflections(staticProfile, state, 1.0);
      state = result.clutterState;
    }

    // Now introduce a dynamic target
    const withTarget = new Float32Array([0.3, 0.9, 0.3]);
    const result = suppressStaticReflections(withTarget, state, 1.0);
    // Static bins should be near zero, target should be prominent
    expect(result.profile[0]).toBeLessThan(0.1);
    expect(result.profile[1]).toBeGreaterThan(0.4); // 0.9 - ~0.3 model
    expect(result.profile[2]).toBeLessThan(0.1);
  });

  it('clamps negative values to zero', () => {
    let state = createClutterState();
    const highProfile = new Float32Array([1.0, 1.0]);

    // Train model on high values
    for (let i = 0; i < 50; i++) {
      const result = suppressStaticReflections(highProfile, state, 1.0);
      state = result.clutterState;
    }

    // Feed a lower profile — subtraction would go negative
    const lowProfile = new Float32Array([0.1, 0.1]);
    const result = suppressStaticReflections(lowProfile, state, 1.0);
    expect(result.profile[0]).toBe(0);
    expect(result.profile[1]).toBe(0);
  });

  it('strength parameter scales subtraction', () => {
    let state = createClutterState();
    const profile = new Float32Array([0.5, 0.5]);

    // Train model
    for (let i = 0; i < 50; i++) {
      const result = suppressStaticReflections(profile, state, 0.5);
      state = result.clutterState;
    }

    // With strength=0.5, only half the model is subtracted
    const result = suppressStaticReflections(profile, state, 0.5);
    // 0.5 - 0.5 * ~0.5 ≈ 0.25
    expect(result.profile[0]).toBeGreaterThan(0.15);
    expect(result.profile[0]).toBeLessThan(0.35);
  });

  it('preserves profile length', () => {
    const profile = new Float32Array(240);
    const state = createClutterState();
    const result = suppressStaticReflections(profile, state, 1.0);
    expect(result.profile.length).toBe(240);
  });

  it('reinitializes model when length changes', () => {
    const profile1 = new Float32Array([0.5, 0.5, 0.5]);
    let state = createClutterState();
    const r1 = suppressStaticReflections(profile1, state, 1.0);
    state = r1.clutterState;

    // Different length — model should reinitialize
    const profile2 = new Float32Array([0.5, 0.5]);
    const r2 = suppressStaticReflections(profile2, state, 1.0);
    // Should not crash, should return unchanged profile (new model = zeros)
    expect(r2.profile[0]).toBeCloseTo(0.5);
    expect(r2.profile[1]).toBeCloseTo(0.5);
  });
});

describe('applyEnvBaseline', () => {
  it('returns profile unchanged when baseline is null', () => {
    const profile = new Float32Array([0.5, 0.8, 0.3]);
    const result = applyEnvBaseline(profile, null, 1.0);
    expect(result).toBe(profile); // same reference
  });

  it('returns profile unchanged when lengths mismatch', () => {
    const profile = new Float32Array([0.5, 0.8, 0.3]);
    const baseline = new Float32Array([0.1, 0.1]);
    const result = applyEnvBaseline(profile, baseline, 1.0);
    expect(result).toBe(profile);
  });

  it('subtracts baseline scaled by strength', () => {
    const profile = new Float32Array([0.5, 0.8, 0.3]);
    const baseline = new Float32Array([0.2, 0.3, 0.1]);
    const result = applyEnvBaseline(profile, baseline, 1.0);
    expect(result[0]).toBeCloseTo(0.3);
    expect(result[1]).toBeCloseTo(0.5);
    expect(result[2]).toBeCloseTo(0.2);
  });

  it('respects strength parameter', () => {
    const profile = new Float32Array([0.5, 0.8]);
    const baseline = new Float32Array([0.4, 0.4]);
    const result = applyEnvBaseline(profile, baseline, 0.5);
    // 0.5 - 0.5*0.4 = 0.3, 0.8 - 0.5*0.4 = 0.6
    expect(result[0]).toBeCloseTo(0.3);
    expect(result[1]).toBeCloseTo(0.6);
  });

  it('clamps negative results to zero', () => {
    const profile = new Float32Array([0.1, 0.2]);
    const baseline = new Float32Array([0.5, 0.5]);
    const result = applyEnvBaseline(profile, baseline, 1.0);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
  });
});
