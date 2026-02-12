import { genChirp } from '../../src/signal/chirp.js';
import { correlate } from '../../src/dsp/correlate.js';

describe('genChirp', () => {
  it('generates correct length', () => {
    const sr = 48000;
    const result = genChirp({ f1: 2000, f2: 9000, durationMs: 10 }, sr);
    expect(result.length).toBe(Math.floor(sr * 0.01));
  });

  it('output is windowed (starts and ends near zero)', () => {
    const result = genChirp({ f1: 2000, f2: 9000, durationMs: 10 }, 48000);
    expect(Math.abs(result[0])).toBeLessThan(0.01);
    expect(Math.abs(result[result.length - 1])).toBeLessThan(0.01);
  });

  it('clamps frequencies', () => {
    // Very low f1 should be clamped to MIN_FREQUENCY
    const result = genChirp({ f1: 100, f2: 200, durationMs: 10 }, 48000);
    expect(result.length).toBeGreaterThan(0);
  });

  it('peak amplitude near 1.0 at center', () => {
    const chirp = genChirp({ f1: 2000, f2: 9000, durationMs: 10 }, 48000);
    let maxAbs = 0;
    for (let i = 0; i < chirp.length; i++) {
      if (Math.abs(chirp[i]) > maxAbs) maxAbs = Math.abs(chirp[i]);
    }
    expect(maxAbs).toBeGreaterThan(0.8);
    expect(maxAbs).toBeLessThanOrEqual(1.0);
  });

  it('upsweep has increasing zero-crossing rate', () => {
    const chirp = genChirp({ f1: 2000, f2: 9000, durationMs: 20 }, 48000);
    const quarter = Math.floor(chirp.length / 4);

    function countZC(start: number, end: number) {
      let count = 0;
      for (let i = start + 1; i < end; i++) {
        if (chirp[i - 1] * chirp[i] < 0) count++;
      }
      return count;
    }

    // Compare second quarter (lower freq) vs third quarter (higher freq)
    const earlyZC = countZC(quarter, 2 * quarter);
    const lateZC = countZC(2 * quarter, 3 * quarter);
    expect(lateZC).toBeGreaterThan(earlyZC);
  });

  it('autocorrelation has dominant peak at lag 0', () => {
    const sr = 48000;
    const chirp = genChirp({ f1: 2000, f2: 9000, durationMs: 20 }, sr);
    const padded = new Float32Array(chirp.length * 2);
    padded.set(chirp);
    const corr = correlate(padded, chirp);

    let maxIdx = 0, maxVal = -Infinity;
    for (let i = 0; i < corr.length; i++) {
      if (corr[i] > maxVal) { maxVal = corr[i]; maxIdx = i; }
    }
    expect(maxIdx).toBe(0);

    // Sidelobes suppressed (Hann window helps); check further from main lobe
    for (let i = 10; i < Math.min(50, corr.length); i++) {
      expect(Math.abs(corr[i]) / maxVal).toBeLessThan(0.5);
    }
  });

  it('produces pure tone when f1 equals f2', () => {
    const chirp = genChirp({ f1: 3000, f2: 3000, durationMs: 10 }, 48000);
    expect(chirp.length).toBe(480);
    // Near-center sample should have significant amplitude (Hann window peaks at center)
    // Avoid exact center which may coincide with a zero crossing of the sine
    let maxNearCenter = 0;
    const mid = Math.floor(chirp.length / 2);
    for (let i = mid - 5; i <= mid + 5; i++) {
      if (Math.abs(chirp[i]) > maxNearCenter) maxNearCenter = Math.abs(chirp[i]);
    }
    expect(maxNearCenter).toBeGreaterThan(0.3);
  });

  it('handles zero duration without NaN', () => {
    const chirp = genChirp({ f1: 2000, f2: 9000, durationMs: 0 }, 48000);
    for (let i = 0; i < chirp.length; i++) {
      expect(Number.isFinite(chirp[i])).toBe(true);
    }
  });

  it('supports downsweep (f1 > f2)', () => {
    const chirp = genChirp({ f1: 9000, f2: 2000, durationMs: 20 }, 48000);
    const quarter = Math.floor(chirp.length / 4);

    function countZC(start: number, end: number) {
      let count = 0;
      for (let i = start + 1; i < end; i++) {
        if (chirp[i - 1] * chirp[i] < 0) count++;
      }
      return count;
    }

    const earlyZC = countZC(quarter, 2 * quarter);
    const lateZC = countZC(2 * quarter, 3 * quarter);
    // Downsweep: later section should have fewer zero crossings
    expect(earlyZC).toBeGreaterThan(lateZC);
  });

  it('works at different sample rates', () => {
    for (const sr of [44100, 48000, 16000]) {
      const chirp = genChirp({ f1: 2000, f2: 8000, durationMs: 10 }, sr);
      expect(chirp.length).toBe(Math.floor(sr * 0.01));
    }
  });
});
