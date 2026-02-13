import { resolveAutoQualityAlgo } from '../../src/dsp/quality.js';

describe('adaptive auto quality resolver', () => {
  it('selects max for low-PSR scene', () => {
    const low = new Float32Array(64).fill(0.1);
    low[30] = 0.12;

    const result = resolveAutoQualityAlgo(
      low,
      { ewmaMs: 0, lastResolved: 'balanced', lastSwitchAt: 0 },
      5000,
      { enabled: true, hysteresisMs: 200 },
    );

    expect(result.resolved).toBe('max');
  });

  it('selects fast for high-PSR scene', () => {
    const high = new Float32Array(64).fill(0.01);
    high[30] = 1.0;

    const result = resolveAutoQualityAlgo(
      high,
      { ewmaMs: 0, lastResolved: 'balanced', lastSwitchAt: 0 },
      5000,
      { enabled: true, hysteresisMs: 200 },
    );

    expect(result.resolved).toBe('fast');
  });

  it('respects hysteresis dwell and prevents flapping', () => {
    const low = new Float32Array(64).fill(0.1);
    low[30] = 0.12;

    const result = resolveAutoQualityAlgo(
      low,
      { ewmaMs: 0, lastResolved: 'balanced', lastSwitchAt: 4900 },
      5000,
      { enabled: true, hysteresisMs: 500 },
    );

    expect(result.resolved).toBe('balanced');
    expect(result.switched).toBe(false);
  });
});
