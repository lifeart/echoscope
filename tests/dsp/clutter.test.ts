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

  // Adaptive novelty tests
  it('uses base noveltyRatio when adaptiveNovelty=false', () => {
    const staticProfile = new Float32Array([0.5, 0.5, 0.5]);
    let state = createClutterState();

    // Train model with selectiveUpdate enabled but adaptiveNovelty=false
    // With selectiveUpdate enabled, static bins (cleaned ~= 0 after training)
    // won't be flagged as novel, so full alpha is used. Need more iterations.
    for (let i = 0; i < 200; i++) {
      const result = suppressStaticReflections(staticProfile, state, 1.0, {
        selectiveUpdate: { enabled: true, noveltyRatio: 0.35, adaptiveNovelty: false },
      });
      state = result.clutterState;
    }

    // After many iterations, the model converges to staticProfile
    // So suppression should reduce values significantly
    const final = suppressStaticReflections(staticProfile, state, 1.0, {
      selectiveUpdate: { enabled: true, noveltyRatio: 0.35, adaptiveNovelty: false },
    });
    for (let i = 0; i < final.profile.length; i++) {
      expect(final.profile[i]).toBeLessThan(0.15);
    }
  });

  it('high confidence leads to lower effective ratio and more bins flagged as novel', () => {
    // With high confidence (0.9), effectiveNoveltyRatio = 0.50 - 0.9*(0.50-0.15) = 0.185
    // With low confidence (0.1), effectiveNoveltyRatio = 0.50 - 0.1*(0.50-0.15) = 0.465
    // Novel check: out[i] > raw * effectiveNoveltyRatio
    // We need the cleaned value to be between the two thresholds so that
    // high-conf flags it as novel (slow alpha) but low-conf does not (fast alpha).

    // Use a small bump above static floor so cleaned value is moderate.
    const staticProfile = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5]);

    // Train both models identically on static profile
    let stateHigh = createClutterState();
    let stateLow = createClutterState();
    for (let i = 0; i < 100; i++) {
      stateHigh = suppressStaticReflections(staticProfile, stateHigh, 1.0, {
        selectiveUpdate: { enabled: true, noveltyRatio: 0.35, adaptiveNovelty: true, confidence: 0.9 },
      }).clutterState;
      stateLow = suppressStaticReflections(staticProfile, stateLow, 1.0, {
        selectiveUpdate: { enabled: true, noveltyRatio: 0.35, adaptiveNovelty: true, confidence: 0.1 },
      }).clutterState;
    }

    // Target with moderate bump: model is ~0.5, target bin = 0.72.
    // cleaned = 0.72 - 0.5 = 0.22
    // High conf check: 0.22 > 0.72 * 0.185 = 0.1332 → YES, novel (slow update)
    // Low conf check:  0.22 > 0.72 * 0.465 = 0.3348 → NO, not novel (fast update)
    const withTarget = new Float32Array([0.5, 0.5, 0.72, 0.5, 0.5]);

    let highTargetEnergy = 0;
    let lowTargetEnergy = 0;
    for (let i = 0; i < 30; i++) {
      const rH = suppressStaticReflections(withTarget, stateHigh, 1.0, {
        selectiveUpdate: { enabled: true, noveltyRatio: 0.35, adaptiveNovelty: true, confidence: 0.9 },
      });
      stateHigh = rH.clutterState;
      highTargetEnergy = rH.profile[2];

      const rL = suppressStaticReflections(withTarget, stateLow, 1.0, {
        selectiveUpdate: { enabled: true, noveltyRatio: 0.35, adaptiveNovelty: true, confidence: 0.1 },
      });
      stateLow = rL.clutterState;
      lowTargetEnergy = rL.profile[2];
    }

    // High confidence: target bin flagged as novel → model updates slower (alpha * 0.15)
    // → model stays lower → more residual energy after suppression
    // Low confidence: target bin NOT flagged as novel → model updates faster (full alpha)
    // → model absorbs the target → less residual energy
    expect(highTargetEnergy).toBeGreaterThan(lowTargetEnergy);
  });

  it('low confidence leads to higher effective ratio and fewer bins flagged as novel', () => {
    // Same logic in reverse: low conf → higher ratio → target not flagged as novel
    // → full alpha model update → model absorbs target faster → less residual energy
    const staticProfile = new Float32Array([0.4, 0.4, 0.4]);

    let stateHigh = createClutterState();
    let stateLow = createClutterState();
    for (let i = 0; i < 100; i++) {
      stateHigh = suppressStaticReflections(staticProfile, stateHigh, 1.0, {
        selectiveUpdate: { enabled: true, noveltyRatio: 0.35, adaptiveNovelty: true, confidence: 0.9 },
      }).clutterState;
      stateLow = suppressStaticReflections(staticProfile, stateLow, 1.0, {
        selectiveUpdate: { enabled: true, noveltyRatio: 0.35, adaptiveNovelty: true, confidence: 0.1 },
      }).clutterState;
    }

    // Moderate target: model ~0.4, target = 0.58
    // cleaned = 0.58 - 0.4 = 0.18
    // High conf: 0.18 > 0.58 * 0.185 = 0.1073 → YES, novel
    // Low conf:  0.18 > 0.58 * 0.465 = 0.2697 → NO, not novel
    const withTarget = new Float32Array([0.4, 0.58, 0.4]);

    let lowEnergy = 0;
    let highEnergy = 0;
    for (let i = 0; i < 30; i++) {
      const rL = suppressStaticReflections(withTarget, stateLow, 1.0, {
        selectiveUpdate: { enabled: true, noveltyRatio: 0.35, adaptiveNovelty: true, confidence: 0.1 },
      });
      stateLow = rL.clutterState;
      lowEnergy = rL.profile[1];

      const rH = suppressStaticReflections(withTarget, stateHigh, 1.0, {
        selectiveUpdate: { enabled: true, noveltyRatio: 0.35, adaptiveNovelty: true, confidence: 0.9 },
      });
      stateHigh = rH.clutterState;
      highEnergy = rH.profile[1];
    }

    // Low confidence → not novel → fast model update → less residual
    // High confidence → novel → slow model update → more residual
    expect(lowEnergy).toBeLessThan(highEnergy);
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
