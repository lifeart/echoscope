import { compensateLatency, measureRoundTripLatency } from '../../src/audio/latency.js';

describe('compensateLatency', () => {
  it('trims beginning by delay samples', () => {
    const samples = new Float32Array([0, 0, 0, 1, 2, 3]);
    const result = compensateLatency(samples, 0.001, 0.001, 1000);
    // 0.002s * 1000 = 2 samples trimmed
    expect(result.adjusted.length).toBe(4);
    expect(result.adjusted[0]).toBe(0);
    expect(result.totalLatencyMs).toBeCloseTo(2);
  });

  it('returns original for zero latency', () => {
    const samples = new Float32Array([1, 2, 3]);
    const result = compensateLatency(samples, 0, 0, 48000);
    expect(result.adjusted.length).toBe(3);
  });
});

describe('measureRoundTripLatency', () => {
  it('sums latencies', () => {
    expect(measureRoundTripLatency(0.005, 0.003, 10)).toBeCloseTo(18);
  });
});
