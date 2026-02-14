import { buildRangePrior, selectPeakWithRangePrior } from '../../src/scan/range-prior.js';
import type { TargetState } from '../../src/types.js';

function mkTrack(range: number, missCount = 0, confidence = 0.5): TargetState {
  return {
    id: 1,
    position: { range, angleDeg: 0 },
    velocity: { rangeRate: 0, angleRate: 0 },
    covariance: new Float64Array(16),
    age: 1,
    missCount,
    confidence,
  };
}

describe('range prior', () => {
  it('uses active track as strongest prior source', () => {
    const prior = buildRangePrior([mkTrack(2.05, 0, 0.8)], Number.NaN, 0.3, 4.0);
    expect(prior).not.toBeNull();
    expect(prior?.source).toBe('track');
    expect(prior?.center).toBeCloseTo(2.05, 3);
  });

  it('falls back to last target when no active track', () => {
    const prior = buildRangePrior([mkTrack(1.8, 7, 0.2)], 1.95, 0.3, 4.0);
    expect(prior).not.toBeNull();
    expect(prior?.source).toBe('last-target');
    expect(prior?.center).toBeCloseTo(1.95, 3);
  });

  it('selects MAP peak near prior over slightly larger outlier', () => {
    const peaks = [
      { bin: 2, value: 1.12e-4, range: 0.34 },
      { bin: 104, value: 1.03e-4, range: 1.98 },
      { bin: 210, value: 9.1e-5, range: 3.71 },
    ];
    const prior = { center: 2.0, sigma: 0.35, source: 'track' as const };

    const selected = selectPeakWithRangePrior(peaks, prior);
    expect(selected).not.toBeNull();
    expect(selected?.bin).toBe(104);
    expect(selected?.range).toBeCloseTo(1.98, 2);
    expect(selected?.zScore).toBeLessThan(1);
  });
});