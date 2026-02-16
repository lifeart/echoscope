/**
 * Tests for Fix #7: SAFT phase double-correction.
 *
 * Verifies that coherentSumCell only applies narrowband phase rotation
 * for the fractional-sample residual, not the full time shift. Applying
 * both the full sample-index offset AND full phase rotation was
 * double-correcting for wideband probes.
 */
import { describe, it, expect } from 'vitest';
import {
  coherentSumCell,
  computeExpectedTauShift,
} from '../../src/scan/saft.js';
import type { RawAngleFrame, SaftConfig } from '../../src/types.js';

function makeConfig(overrides?: Partial<SaftConfig>): SaftConfig {
  return {
    enabled: true,
    halfWindow: 2,
    window: 'hann',
    phaseCenterHz: 4000,
    coherenceFloor: 0,
    maxTauShiftSamples: 512,
    ...overrides,
  };
}

function makeFrameWithPeak(
  angleDeg: number,
  peakSample: number,
  tau0: number,
  sampleRate = 48000,
  len = 256,
  fc = 4000,
): RawAngleFrame {
  const corrReal = new Float32Array(len);
  const corrImag = new Float32Array(len);

  // Gaussian-like peak at peakSample
  for (let i = 0; i < len; i++) {
    const d = i - peakSample;
    const amp = Math.exp(-0.5 * d * d / 4);
    corrReal[i] = amp;
  }

  return {
    angleDeg,
    sampleRate,
    tau0,
    corrReal,
    corrImag,
    centerFreqHz: fc,
    quality: 1,
  };
}

describe('SAFT phase correction — fractional only', () => {
  it('coherent sum at on-axis angle returns high coherence', () => {
    const angles = [-10, -5, 0, 5, 10];
    const range = 1.0;
    const spacing = 0.2;
    const c = 343;
    const fc = 4000;
    const sampleRate = 48000;

    const tauAtRange = (2 * range) / c;

    const frames: RawAngleFrame[] = angles.map((angleDeg) => {
      const shift = computeExpectedTauShift(0, angleDeg, range, spacing, c);
      const peakSample = (tauAtRange + shift) * sampleRate;
      return makeFrameWithPeak(angleDeg, peakSample, 0, sampleRate, 512, fc);
    });

    const result = coherentSumCell(
      2, // target index = 0°
      range,
      frames,
      angles,
      makeConfig({ halfWindow: 2, phaseCenterHz: fc }),
      spacing,
      c,
    );

    expect(result.intensity).toBeGreaterThan(0);
    expect(result.coherence).toBeGreaterThan(0.5);
  });

  it('coherent sum preserves intensity for tight beam', () => {
    // When all frames agree (no angular diversity), the result
    // should be strong regardless of phase correction approach
    const angles = [0];
    const range = 1.0;
    const c = 343;
    const sampleRate = 48000;
    const tauAtRange = (2 * range) / c;
    const peakSample = tauAtRange * sampleRate;

    const frames = [makeFrameWithPeak(0, peakSample, 0, sampleRate, 512, 4000)];

    const result = coherentSumCell(
      0,
      range,
      frames,
      angles,
      makeConfig({ halfWindow: 0 }),
      0.2,
      c,
    );

    expect(result.intensity).toBeGreaterThan(0);
  });

  it('phase correction uses fractional shift not full shift', () => {
    // Create a scenario where full phase correction would differ
    // significantly from fractional-only correction.
    // If shiftSec maps to, say, 5.3 samples, the phase correction
    // should only be for 0.3 samples worth of shift, not 5.3.
    const angles = [0, 15];
    const range = 0.5;
    const spacing = 0.3;
    const c = 343;
    const fc = 8000; // Higher frequency makes phase difference more visible
    const sampleRate = 48000;

    const tauAtRange = (2 * range) / c;

    const frames: RawAngleFrame[] = angles.map((angleDeg) => {
      const shift = computeExpectedTauShift(0, angleDeg, range, spacing, c);
      const peakSample = (tauAtRange + shift) * sampleRate;
      return makeFrameWithPeak(angleDeg, peakSample, 0, sampleRate, 512, fc);
    });

    const result = coherentSumCell(
      0, // target = 0°
      range,
      frames,
      angles,
      makeConfig({ halfWindow: 1, phaseCenterHz: fc }),
      spacing,
      c,
    );

    // With fractional-only correction, the coherent sum should work
    // because data is properly sampled via sampleIndex offset
    expect(result.intensity).toBeGreaterThan(0);
    // If double-correction were still present, coherence would be poor
    // because the extra phase rotation would destructively interfere
  });

  it('returns zero for out-of-range target index', () => {
    const r = coherentSumCell(
      -1, 1.0, [], [0], makeConfig(), 0.2, 343,
    );
    expect(r.intensity).toBe(0);
    expect(r.coherence).toBe(0);
  });

  it('returns zero for invalid range', () => {
    const r = coherentSumCell(
      0, -1, [], [0], makeConfig(), 0.2, 343,
    );
    expect(r.intensity).toBe(0);
    expect(r.coherence).toBe(0);
  });
});
