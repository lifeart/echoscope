import { softFilterRepeats, type RepeatMeasurement } from '../../src/calibration/engine.js';

function mkRepeat(tauL: number, tauR: number, tdoaRatio: number): RepeatMeasurement {
  return { tauL, tauR, qualL: 0.8, qualR: 0.8, tdoaRatio, valid: true };
}

describe('softFilterRepeats', () => {
  const maxTDOA = 0.001; // 1 ms

  it('returns cluster unchanged when fewer than 3 members', () => {
    const cluster = [mkRepeat(0.001, 0.0015, 0.90), mkRepeat(0.001, 0.0015, 0.85)];
    const result = softFilterRepeats(cluster, maxTDOA);
    expect(result).toBe(cluster);
    expect(result).toHaveLength(2);
  });

  it('keeps all repeats when none exceed tdoaRatio limit', () => {
    const cluster = [
      mkRepeat(0.001, 0.0015, 0.50),
      mkRepeat(0.001, 0.0015, 0.60),
      mkRepeat(0.001, 0.0015, 0.70),
    ];
    const result = softFilterRepeats(cluster, maxTDOA);
    expect(result).toHaveLength(3);
  });

  it('keeps high-tdoaRatio repeat when delta is consistent with cluster', () => {
    // All repeats have same delta (0.0005) — high tdoaRatio but consistent
    const cluster = [
      mkRepeat(0.001, 0.0015, 0.50),
      mkRepeat(0.001, 0.0015, 0.50),
      mkRepeat(0.001, 0.0015, 0.90), // high ratio, same delta
    ];
    const result = softFilterRepeats(cluster, maxTDOA);
    expect(result).toHaveLength(3);
  });

  it('removes repeat with both high tdoaRatio AND inconsistent delta', () => {
    // Two consistent repeats (delta=0.0005), one outlier (delta=0.001, very different)
    const cluster = [
      mkRepeat(0.001, 0.0015, 0.50),  // delta = 0.0005
      mkRepeat(0.001, 0.0015, 0.50),  // delta = 0.0005
      mkRepeat(0.001, 0.002, 0.90),   // delta = 0.001, high ratio + deviant delta
    ];
    const result = softFilterRepeats(cluster, maxTDOA);
    expect(result).toHaveLength(2);
    expect(result.every(r => r.tdoaRatio === 0.50)).toBe(true);
  });

  it('does not remove if only 1 good repeat would remain', () => {
    // 2 high-ratio + deviant, 1 normal → can't filter to <2
    const cluster = [
      mkRepeat(0.001, 0.0015, 0.50),   // delta = 0.0005 (good)
      mkRepeat(0.001, 0.002, 0.85),     // delta = 0.001, deviant
      mkRepeat(0.001, 0.0021, 0.90),    // delta = 0.0011, deviant
    ];
    const result = softFilterRepeats(cluster, maxTDOA);
    expect(result).toHaveLength(3); // kept all — removing 2 would leave only 1
  });

  it('removes multiple deviant repeats if enough good remain', () => {
    const cluster = [
      mkRepeat(0.001, 0.0015, 0.30),   // delta = 0.0005
      mkRepeat(0.001, 0.0015, 0.40),   // delta = 0.0005
      mkRepeat(0.001, 0.0015, 0.50),   // delta = 0.0005
      mkRepeat(0.001, 0.002, 0.85),    // delta = 0.001, deviant + high ratio
      mkRepeat(0.001, 0.0021, 0.90),   // delta = 0.0011, deviant + high ratio
    ];
    const result = softFilterRepeats(cluster, maxTDOA);
    expect(result).toHaveLength(3);
  });

  it('returns cluster unchanged when maxTDOA is zero', () => {
    const cluster = [
      mkRepeat(0.001, 0.001, 0.90),
      mkRepeat(0.001, 0.001, 0.90),
      mkRepeat(0.001, 0.001, 0.90),
    ];
    const result = softFilterRepeats(cluster, 0);
    expect(result).toBe(cluster);
  });

  it('respects custom tdoaSoftLimit', () => {
    // With default limit 0.80 the repeat at 0.75 would be kept.
    // With stricter limit 0.70, it becomes eligible for removal.
    const cluster = [
      mkRepeat(0.001, 0.0015, 0.30),   // delta = 0.0005
      mkRepeat(0.001, 0.0015, 0.30),   // delta = 0.0005
      mkRepeat(0.001, 0.002, 0.75),    // delta = 0.001, deviant
    ];
    const defaultResult = softFilterRepeats(cluster, maxTDOA);
    expect(defaultResult).toHaveLength(3); // 0.75 < 0.80 default → kept

    const strictResult = softFilterRepeats(cluster, maxTDOA, 0.70);
    expect(strictResult).toHaveLength(2); // 0.75 > 0.70 + deviant → removed
  });

  it('respects custom deltaDevLimit', () => {
    // delta median = 0.0005, outlier delta = 0.001
    // deltaDev = |0.001 - 0.0005| / 0.001 = 0.5
    // Default limit 0.40 → removed. Looser limit 0.60 → kept.
    const cluster = [
      mkRepeat(0.001, 0.0015, 0.50),   // delta = 0.0005
      mkRepeat(0.001, 0.0015, 0.50),   // delta = 0.0005
      mkRepeat(0.001, 0.002, 0.85),    // delta = 0.001, deviant + high ratio
    ];
    const defaultResult = softFilterRepeats(cluster, maxTDOA);
    expect(defaultResult).toHaveLength(2); // deltaDev=0.5 > 0.40 → removed

    const looseResult = softFilterRepeats(cluster, maxTDOA, 0.80, 0.60);
    expect(looseResult).toHaveLength(3); // deltaDev=0.5 < 0.60 → kept
  });
});
