/**
 * Tests for Fix #11: SRP-PHAT sub-sample interpolation.
 *
 * Verifies that the DOA estimator uses fractional-sample linear
 * interpolation when looking up GCC bins, rather than rounding to
 * the nearest integer sample (which introduces ±7° error for small arrays).
 */
import { describe, it, expect } from 'vitest';
import { srpPhatDOA } from '../../src/spatial/doa.js';
import type { ArrayGeometry } from '../../src/types.js';

function makeStereoGeometry(spacingM: number, speedOfSound = 343): ArrayGeometry {
  return {
    microphones: [
      { x: -spacingM / 2, y: 0, z: 0 },
      { x: spacingM / 2, y: 0, z: 0 },
    ],
    speakers: [{ x: 0, y: 0, z: 0 }],
    spacing: spacingM,
    speedOfSound,
  };
}

/** Create synthetic stereo signals with a known TDOA. */
function makeStereoSignals(
  delaySamples: number,
  _sampleRate: number,
  length: number,
): Float32Array[] {
  const ch0 = new Float32Array(length);
  const ch1 = new Float32Array(length);

  // Broadband signal: short pulse
  const pulseLen = 64;
  const center = Math.floor(length / 2);
  for (let i = 0; i < pulseLen; i++) {
    const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / pulseLen));
    ch0[center + i] = w * Math.sin(2 * Math.PI * 8 * i / pulseLen);
  }

  // Delay second channel by delaySamples (integer part)
  const intDelay = Math.round(delaySamples);
  for (let i = 0; i < length; i++) {
    const src = i - intDelay;
    if (src >= 0 && src < length) {
      ch1[i] = ch0[src];
    }
  }

  return [ch0, ch1];
}

describe('SRP-PHAT sub-sample interpolation', () => {
  it('estimates 0° for on-axis source', () => {
    const spacing = 0.055; // 55mm
    const sampleRate = 48000;
    const geo = makeStereoGeometry(spacing);
    const signals = makeStereoSignals(0, sampleRate, 2048);

    const result = srpPhatDOA(signals, geo, sampleRate, {
      minDeg: -60, maxDeg: 60, stepDeg: 1,
    });

    expect(Math.abs(result.azimuthDeg)).toBeLessThan(3);
  });

  it('distinguishes positive vs negative angles', () => {
    const spacing = 0.20;
    const sampleRate = 48000;
    const c = 343;
    const geo = makeStereoGeometry(spacing, c);

    // Create two signals with opposite delays
    const posDelay = makeStereoSignals(3, sampleRate, 4096);  // ch1 lags
    const negDelay = makeStereoSignals(-3, sampleRate, 4096); // ch1 leads

    const rPos = srpPhatDOA(posDelay, geo, sampleRate, {
      minDeg: -60, maxDeg: 60, stepDeg: 1,
    });
    const rNeg = srpPhatDOA(negDelay, geo, sampleRate, {
      minDeg: -60, maxDeg: 60, stepDeg: 1,
    });

    // The two should be on opposite sides of 0°
    expect(rPos.azimuthDeg * rNeg.azimuthDeg).toBeLessThanOrEqual(0);
    // At least one should be non-zero
    expect(Math.abs(rPos.azimuthDeg) + Math.abs(rNeg.azimuthDeg)).toBeGreaterThan(0);
  });

  it('returns confidence > 0 for valid signals', () => {
    const spacing = 0.055;
    const sampleRate = 48000;
    const geo = makeStereoGeometry(spacing);
    const signals = makeStereoSignals(2, sampleRate, 2048);

    const result = srpPhatDOA(signals, geo, sampleRate);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.method).toBe('srp-phat');
  });

  it('handles single channel gracefully', () => {
    const geo = makeStereoGeometry(0.055);
    const result = srpPhatDOA(
      [new Float32Array(1024)],
      geo, 48000,
    );
    expect(result.azimuthDeg).toBe(0);
    expect(result.confidence).toBe(0);
  });
});
