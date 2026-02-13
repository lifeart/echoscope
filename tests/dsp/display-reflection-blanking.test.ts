import { describe, expect, it } from 'vitest';
import { applyDisplayReflectionBlanking } from '../../src/dsp/display-reflection-blanking.js';

describe('applyDisplayReflectionBlanking', () => {
  it('returns original profile when disabled', () => {
    const profile = new Float32Array([0.2, 0.5, 1.0]);
    const out = applyDisplayReflectionBlanking(profile, 0.3, 4.0, {
      enabled: false,
      startRange: 0.3,
      endRange: 0.9,
      attenuation: 0.8,
      edgeSoftness: 0.08,
    });

    expect(out).toBe(profile);
  });

  it('attenuates bins inside blanking range and preserves far bins', () => {
    const profile = new Float32Array(11).fill(1);
    const out = applyDisplayReflectionBlanking(profile, 0, 1, {
      enabled: true,
      startRange: 0.2,
      endRange: 0.4,
      attenuation: 0.8,
      edgeSoftness: 0,
    });

    expect(out[3]).toBeCloseTo(0.2, 6); // r = 0.3 inside window
    expect(out[8]).toBeCloseTo(1, 6);   // r = 0.8 outside window
  });

  it('applies smooth edge transitions when edgeSoftness > 0', () => {
    const profile = new Float32Array(21).fill(1);
    const out = applyDisplayReflectionBlanking(profile, 0, 1, {
      enabled: true,
      startRange: 0.30,
      endRange: 0.50,
      attenuation: 0.8,
      edgeSoftness: 0.10,
    });

    expect(out[3]).toBeCloseTo(1, 6); // r = 0.15 outside
    expect(out[5]).toBeLessThan(1);   // r = 0.25 on left edge ramp
    expect(out[7]).toBeCloseTo(0.4, 6); // r = 0.35 on left edge ramp
    expect(out[8]).toBeCloseTo(0.2, 6); // r = 0.40 plateau
    expect(out[11]).toBeGreaterThan(0.2); // r = 0.55 on right edge ramp
    expect(out[13]).toBeCloseTo(1, 6); // r = 0.65 outside
  });
});
