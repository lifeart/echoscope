import { describe, it, expect, beforeEach } from 'vitest';
import { getProbeFreqBand, bandpassToProbe, resetProbeBandCache } from '../../src/dsp/probe-band.js';
import type { ProbeConfig } from '../../src/types.js';

/**
 * Tests for probe-band cache management, reset, and edge configurations.
 * Extends the main probe-band.test.ts which covers core filtering behavior.
 */

const SR = 48000;

function makeChirpProbe(f1: number, f2: number): ProbeConfig {
  return { type: 'chirp', params: { f1, f2, durationMs: 7 } };
}

function makeMlsProbe(chipRate: number): ProbeConfig {
  return { type: 'mls', params: { order: 12, chipRate } };
}

function makeGolayProbe(chipRate: number): ProbeConfig {
  return { type: 'golay', params: { order: 10, chipRate, gapMs: 12 } };
}

function makeMultiplexProbe(fStart: number, fEnd: number): ProbeConfig {
  return {
    type: 'multiplex',
    params: {
      carrierCount: 6, fStart, fEnd, symbolMs: 8,
      guardHz: 180, minSpacingHz: 220, calibrationCandidates: 12,
      fusion: 'snrWeighted',
    },
  };
}

function pseudoNoise(len: number, amplitude: number, seed = 42): Float32Array {
  const buf = new Float32Array(len);
  let s = seed;
  for (let i = 0; i < len; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    buf[i] = ((s / 0x7fffffff) - 0.5) * 2 * amplitude;
  }
  return buf;
}

describe('probe-band cache and reset', () => {
  beforeEach(() => {
    resetProbeBandCache();
  });

  it('resetProbeBandCache causes re-design on next call', () => {
    const probe = makeChirpProbe(2000, 9000);
    const signal = pseudoNoise(2000, 0.1);

    // First call designs the filter
    const result1 = bandpassToProbe(signal, probe, SR);
    expect(result1).not.toBe(signal); // filtered = new buffer

    // Reset cache
    resetProbeBandCache();

    // Second call should also filter (not skip due to stale cache)
    const result2 = bandpassToProbe(signal, probe, SR);
    expect(result2).not.toBe(signal);
    expect(result2.length).toBe(signal.length);
  });

  it('same probe config reuses cached filter (same result)', () => {
    const probe = makeChirpProbe(2000, 9000);
    const signal = pseudoNoise(2000, 0.1, 77);

    const result1 = bandpassToProbe(signal, probe, SR);
    const result2 = bandpassToProbe(signal, probe, SR);

    // Same filter coefficients → identical output
    for (let i = 0; i < result1.length; i++) {
      expect(result1[i]).toBe(result2[i]);
    }
  });

  it('different probe config produces different filtered output', () => {
    const probeNarrow = makeChirpProbe(3000, 5000);
    const probeWide = makeChirpProbe(1000, 10000);
    const signal = pseudoNoise(2000, 0.1, 88);

    const resultNarrow = bandpassToProbe(signal, probeNarrow, SR);
    resetProbeBandCache();
    const resultWide = bandpassToProbe(signal, probeWide, SR);

    // Narrow band should have less energy than wide band
    let energyNarrow = 0, energyWide = 0;
    for (let i = 0; i < signal.length; i++) {
      energyNarrow += resultNarrow[i] * resultNarrow[i];
      energyWide += resultWide[i] * resultWide[i];
    }
    expect(energyNarrow).toBeLessThan(energyWide);
  });
});

describe('probe-band edge configurations', () => {
  beforeEach(() => {
    resetProbeBandCache();
  });

  it('MLS with low chipRate produces narrow band filter', () => {
    const probe = makeMlsProbe(1000); // 0–500 Hz band
    const band = getProbeFreqBand(probe);
    expect(band.fLow).toBe(0);
    expect(band.fHigh).toBe(500);

    // Should filter (band is narrow)
    const signal = pseudoNoise(2000, 0.1);
    const filtered = bandpassToProbe(signal, probe, SR);
    expect(filtered).not.toBe(signal);

    // Most energy should be removed (only 500/24000 of Nyquist)
    let origE = 0, filtE = 0;
    for (let i = 0; i < signal.length; i++) {
      origE += signal[i] * signal[i];
      filtE += filtered[i] * filtered[i];
    }
    expect(filtE / origE).toBeLessThan(0.25);
  });

  it('Golay band matches MLS with same chipRate', () => {
    const mlsBand = getProbeFreqBand(makeMlsProbe(6000));
    const golayBand = getProbeFreqBand(makeGolayProbe(6000));
    expect(golayBand.fLow).toBe(mlsBand.fLow);
    expect(golayBand.fHigh).toBe(mlsBand.fHigh);
  });

  it('MLS with very high chipRate covers full spectrum → skips filter', () => {
    // chipRate = 48000 → band 0–24000 = full Nyquist → no filter needed
    const probe = makeMlsProbe(SR);
    const signal = pseudoNoise(200, 0.1);
    const filtered = bandpassToProbe(signal, probe, SR);
    // Should return same reference (no filtering)
    expect(filtered).toBe(signal);
  });

  it('multiplex probe with narrow band filters correctly', () => {
    const probe = makeMultiplexProbe(3000, 5000);
    const band = getProbeFreqBand(probe);
    expect(band.fLow).toBe(3000);
    expect(band.fHigh).toBe(5000);

    // Signal with in-band and out-of-band components
    const signal = new Float32Array(4000);
    for (let i = 0; i < signal.length; i++) {
      const t = i / SR;
      signal[i] = Math.sin(2 * Math.PI * 4000 * t) * 0.5   // in-band
                + Math.sin(2 * Math.PI * 500 * t) * 0.5;    // out-of-band
    }
    const filtered = bandpassToProbe(signal, probe, SR);

    let origE = 0, filtE = 0;
    for (let i = 0; i < signal.length; i++) {
      origE += signal[i] * signal[i];
      filtE += filtered[i] * filtered[i];
    }
    // Out-of-band 500 Hz should be removed → ~50% energy loss
    expect(filtE / origE).toBeLessThan(0.75);
    expect(filtE / origE).toBeGreaterThan(0.15);
  });

  it('200 Hz margin keeps nearby frequencies', () => {
    // Chirp 3000–5000 Hz → with 200 Hz margin → filter passes 2800–5200 Hz
    const probe = makeChirpProbe(3000, 5000);
    const signal = new Float32Array(4000);

    // 2900 Hz is within margin (should pass)
    for (let i = 0; i < signal.length; i++) {
      signal[i] = Math.sin(2 * Math.PI * 2900 * i / SR);
    }
    const filtered = bandpassToProbe(signal, probe, SR);

    let origE = 0, filtE = 0;
    for (let i = 0; i < signal.length; i++) {
      origE += signal[i] * signal[i];
      filtE += filtered[i] * filtered[i];
    }
    // 2900 Hz is within the 200 Hz margin → significant energy preserved
    // FIR filter rolloff means edge-of-margin frequencies get partial attenuation
    expect(filtE / origE).toBeGreaterThan(0.3);
  });
});
