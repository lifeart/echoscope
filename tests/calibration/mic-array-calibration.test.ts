import {
  buildMicArrayCalibrationFromRepeats,
  type RepeatMeasurement,
} from '../../src/calibration/engine.js';

function mkRepeat(tauL: number, tauR: number, qual = 0.45): RepeatMeasurement {
  return {
    tauL,
    tauR,
    qualL: qual,
    qualR: qual,
    tdoaRatio: 0.3,
    valid: true,
  };
}

describe('buildMicArrayCalibrationFromRepeats', () => {
  const baseParams = {
    clusterWindow: 0.0005,
    maxTDOA: 0.0007,
    d: 0.2,
    c: 343,
    micYPrior: 0.01,
    fallbackTauMeasured: { L: 0.004, R: 0.0042 },
  };

  it('returns undefined when there are not enough channels', () => {
    const out = buildMicArrayCalibrationFromRepeats({
      ...baseParams,
      repeatsByChannel: [[mkRepeat(0.004, 0.0042), mkRepeat(0.00401, 0.00421)]],
      nowMs: 100,
    });
    expect(out).toBeUndefined();
  });

  it('builds per-channel calibration and relative delay offsets', () => {
    const out = buildMicArrayCalibrationFromRepeats({
      ...baseParams,
      repeatsByChannel: [
        [
          mkRepeat(0.00400, 0.00420),
          mkRepeat(0.00401, 0.00421),
          mkRepeat(0.00399, 0.00419),
        ],
        [
          mkRepeat(0.00415, 0.00435),
          mkRepeat(0.00416, 0.00436),
          mkRepeat(0.00414, 0.00434),
        ],
      ],
      nowMs: 200,
    });

    expect(out).toBeDefined();
    expect(out!.channels.length).toBe(2);
    expect(out!.generatedAtMs).toBe(200);

    const ch0 = out!.channels.find(ch => ch.channelIndex === 0)!;
    const ch1 = out!.channels.find(ch => ch.channelIndex === 1)!;

    expect(ch0.valid).toBe(true);
    expect(ch1.valid).toBe(true);
    expect(ch0.relativeDelaySec).toBeCloseTo(0, 7);
    expect(ch1.relativeDelaySec).toBeCloseTo(0.00015, 4);
    expect(ch0.distances.L).toBeGreaterThan(0);
    expect(ch1.distances.R).toBeGreaterThan(0);
  });

  it('applies drift guard and falls back to previous calibration', () => {
    const previous = buildMicArrayCalibrationFromRepeats({
      ...baseParams,
      repeatsByChannel: [
        [
          mkRepeat(0.00400, 0.00420),
          mkRepeat(0.00401, 0.00421),
          mkRepeat(0.00399, 0.00419),
        ],
        [
          mkRepeat(0.00415, 0.00435),
          mkRepeat(0.00416, 0.00436),
          mkRepeat(0.00414, 0.00434),
        ],
      ],
      nowMs: 300,
    });

    expect(previous).toBeDefined();

    const out = buildMicArrayCalibrationFromRepeats({
      ...baseParams,
      repeatsByChannel: [
        [
          mkRepeat(0.00400, 0.00420),
          mkRepeat(0.00401, 0.00421),
          mkRepeat(0.00399, 0.00419),
        ],
        [
          mkRepeat(0.00520, 0.00540),
          mkRepeat(0.00522, 0.00542),
          mkRepeat(0.00518, 0.00538),
        ],
      ],
      previous: previous!,
      nowMs: 400,
    });

    expect(out).toBeDefined();
    expect(out!.generatedAtMs).toBe(400);
    expect(out!.driftFromPrevious?.resetApplied).toBe(true);

    const prevCh1 = previous!.channels.find(ch => ch.channelIndex === 1)!;
    const nextCh1 = out!.channels.find(ch => ch.channelIndex === 1)!;
    expect(nextCh1.relativeDelaySec).toBeCloseTo(prevCh1.relativeDelaySec, 8);
  });
});
