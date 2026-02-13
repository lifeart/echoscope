import { aggregateProfiles } from '../../src/scan/heatmap-data.js';

describe('multiping aggregation modes', () => {
  it('median and trimmedMean reject single-pass spikes better than mean', () => {
    const stable = [
      new Float32Array([0.1, 1.0, 0.1, 0.1]),
      new Float32Array([0.1, 1.0, 0.1, 0.1]),
      new Float32Array([0.1, 1.0, 0.1, 0.1]),
      new Float32Array([0.1, 1.0, 0.1, 0.1]),
      new Float32Array([0.1, 0.0, 0.1, 5.0]),
    ];

    const mean = aggregateProfiles(stable, { mode: 'mean' });
    const median = aggregateProfiles(stable, { mode: 'median' });
    const trimmed = aggregateProfiles(stable, { mode: 'trimmedMean', trimFraction: 0.2 });

    expect(mean.bestBin).toBe(3);
    expect(median.bestBin).toBe(1);
    expect(trimmed.bestBin).toBe(1);
  });

  it('trimmedMean falls back safely when trim is too aggressive', () => {
    const profiles = [
      new Float32Array([0.2, 0.8]),
      new Float32Array([0.2, 0.9]),
      new Float32Array([0.2, 0.7]),
    ];

    const result = aggregateProfiles(profiles, { mode: 'trimmedMean', trimFraction: 0.45 });
    expect(result.averaged.length).toBe(2);
    expect(result.bestBin).toBe(1);
    expect(result.bestVal).toBeGreaterThan(0.7);
  });
});
