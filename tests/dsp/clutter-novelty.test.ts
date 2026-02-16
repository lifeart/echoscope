/**
 * Tests for Fix #10: Clutter novelty detection uses raw-vs-model comparison.
 *
 * Verifies that the novelty decision compares raw samples directly against
 * the background model (raw > bg * (1 + ratio)) rather than using the
 * subtraction output, which would create a circular dependency.
 */
import { describe, it, expect } from 'vitest';
import {
  suppressStaticReflections,
  createClutterState,
} from '../../src/dsp/clutter.js';

describe('clutter novelty detection', () => {
  it('novel bins are absorbed slowly into the model', () => {
    let state = createClutterState();
    const staticProfile = new Float32Array([0.3, 0.3, 0.3, 0.3]);

    // Train the model on static background
    for (let i = 0; i < 80; i++) {
      const result = suppressStaticReflections(staticProfile, state, 1.0, {
        modelAlpha: 0.08,
        selectiveUpdate: { enabled: true, noveltyRatio: 0.35 },
      });
      state = result.clutterState;
    }

    // Now introduce a new target — it should be flagged as novel
    // and absorbed at 15% rate (modelAlpha * 0.15)
    const withTarget = new Float32Array([0.3, 0.3, 0.9, 0.3]);
    const r1 = suppressStaticReflections(withTarget, state, 1.0, {
      modelAlpha: 0.08,
      selectiveUpdate: { enabled: true, noveltyRatio: 0.35 },
    });
    state = r1.clutterState;

    // Target bin should still pass through (not fully suppressed)
    expect(r1.profile[2]).toBeGreaterThan(0.3);

    // After one more frame, the model at bin 2 should have barely moved
    // (slow adaptation for novel bins)
    const r2 = suppressStaticReflections(withTarget, r1.clutterState, 1.0, {
      modelAlpha: 0.08,
      selectiveUpdate: { enabled: true, noveltyRatio: 0.35 },
    });

    // Target should still be visible
    expect(r2.profile[2]).toBeGreaterThan(0.2);
  });

  it('static bins are absorbed quickly into the model', () => {
    let state = createClutterState();
    const staticProfile = new Float32Array([0.5, 0.5, 0.5, 0.5]);

    // With selective update enabled, static bins should adapt at full rate
    for (let i = 0; i < 200; i++) {
      const result = suppressStaticReflections(staticProfile, state, 1.0, {
        modelAlpha: 0.08,
        selectiveUpdate: { enabled: true, noveltyRatio: 0.35 },
      });
      state = result.clutterState;
    }

    // After convergence, subtracted output should be near zero
    const final = suppressStaticReflections(staticProfile, state, 1.0, {
      modelAlpha: 0.08,
      selectiveUpdate: { enabled: true, noveltyRatio: 0.35 },
    });
    for (let i = 0; i < final.profile.length; i++) {
      expect(final.profile[i]).toBeLessThan(0.05);
    }
  });

  it('novelty detection works with raw > bg * (1 + ratio)', () => {
    let state = createClutterState();
    const bg = new Float32Array([1.0, 1.0, 1.0]);

    // Converge model to bg level
    for (let i = 0; i < 100; i++) {
      const r = suppressStaticReflections(bg, state, 1.0, {
        modelAlpha: 0.1,
        selectiveUpdate: { enabled: true, noveltyRatio: 0.5 },
      });
      state = r.clutterState;
    }

    // Now a value at 1.6 (60% above bg) should be novel (> 1.0 * 1.5)
    const test = new Float32Array([1.0, 1.6, 1.0]);
    const r = suppressStaticReflections(test, state, 1.0, {
      modelAlpha: 0.1,
      selectiveUpdate: { enabled: true, noveltyRatio: 0.5 },
    });

    // Novel bin should be preserved (not fully subtracted)
    expect(r.profile[1]).toBeGreaterThan(0.3);
    // Static bins should be suppressed
    expect(r.profile[0]).toBeLessThan(0.1);
  });
});
