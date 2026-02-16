/**
 * Tests for Fix #15: Kaiser window bandpass option.
 *
 * Verifies that designBandpass supports both Hann (default) and Kaiser
 * windows, and that the Kaiser window provides tunable sidelobe suppression.
 */
import { describe, it, expect } from 'vitest';
import { designBandpass, applyBandpass, kaiserWindow } from '../../src/dsp/bandpass.js';

function measureStopbandAttenuation(
  coeffs: ReturnType<typeof designBandpass>,
  freqHz: number,
): number {
  const half = coeffs.groupDelay;
  let real = 0, imag = 0;
  for (let n = 0; n < coeffs.taps.length; n++) {
    const w = 2 * Math.PI * (freqHz / coeffs.sampleRate) * (n - half);
    real += coeffs.taps[n] * Math.cos(w);
    imag += coeffs.taps[n] * Math.sin(w);
  }
  return Math.sqrt(real * real + imag * imag);
}

describe('kaiserWindow', () => {
  it('produces symmetric window', () => {
    const N = 129;
    const w = kaiserWindow(N, 8.6);
    expect(w.length).toBe(N);
    for (let i = 0; i < Math.floor(N / 2); i++) {
      expect(Math.abs(w[i] - w[N - 1 - i])).toBeLessThan(1e-10);
    }
  });

  it('peaks at center', () => {
    const N = 65;
    const w = kaiserWindow(N, 8.6);
    const center = Math.floor(N / 2);
    for (let i = 0; i < N; i++) {
      expect(w[i]).toBeLessThanOrEqual(w[center] + 1e-10);
    }
  });

  it('values are between 0 and 1', () => {
    const w = kaiserWindow(129, 8.6);
    for (let i = 0; i < w.length; i++) {
      expect(w[i]).toBeGreaterThanOrEqual(0);
      expect(w[i]).toBeLessThanOrEqual(1.0001);
    }
  });

  it('β=0 produces near-rectangular window', () => {
    const w = kaiserWindow(65, 0);
    // β=0 → I₀(0)=1, window is all 1s
    for (let i = 0; i < w.length; i++) {
      expect(w[i]).toBeCloseTo(1.0, 4);
    }
  });

  it('higher β narrows the window shape', () => {
    const w5 = kaiserWindow(129, 5);
    const w12 = kaiserWindow(129, 12);
    // At the edges, higher β gives smaller values
    expect(w12[0]).toBeLessThan(w5[0]);
    expect(w12[128]).toBeLessThan(w5[128]);
  });
});

describe('designBandpass with Kaiser window', () => {
  const sr = 48000;

  it('default (no options) produces Hann window filter', () => {
    const hann = designBandpass(900, 2500, sr, 129);
    const hannExplicit = designBandpass(900, 2500, sr, 129, { windowType: 'hann' });

    // Should produce identical results
    expect(hann.taps.length).toBe(hannExplicit.taps.length);
    for (let i = 0; i < hann.taps.length; i++) {
      expect(hann.taps[i]).toBeCloseTo(hannExplicit.taps[i], 10);
    }
  });

  it('Kaiser window produces symmetric taps', () => {
    const coeffs = designBandpass(900, 2500, sr, 129, {
      windowType: 'kaiser',
      kaiserBeta: 8.6,
    });
    expect(coeffs.taps.length).toBe(129);
    const N = coeffs.taps.length;
    for (let i = 0; i < Math.floor(N / 2); i++) {
      expect(Math.abs(coeffs.taps[i] - coeffs.taps[N - 1 - i])).toBeLessThan(1e-10);
    }
  });

  it('Kaiser passband has unity gain at center', () => {
    const coeffs = designBandpass(900, 2500, sr, 129, {
      windowType: 'kaiser',
      kaiserBeta: 8.6,
    });
    const fCenter = (900 + 2500) / 2;
    const mag = measureStopbandAttenuation(coeffs, fCenter);
    expect(Math.abs(mag - 1.0)).toBeLessThan(0.05);
  });

  it('Kaiser stopband is attenuated', () => {
    const coeffs = designBandpass(900, 2500, sr, 129, {
      windowType: 'kaiser',
      kaiserBeta: 8.6,
    });
    const lowStop = measureStopbandAttenuation(coeffs, 200);
    const highStop = measureStopbandAttenuation(coeffs, 8000);
    expect(lowStop).toBeLessThan(0.1);
    expect(highStop).toBeLessThan(0.1);
  });

  it('higher Kaiser β gives deeper stopband rejection at far stopband', () => {
    // Use more taps and measure far into the stopband where higher β
    // has unambiguously better rejection despite wider transition band
    const low = designBandpass(2000, 6000, sr, 257, {
      windowType: 'kaiser',
      kaiserBeta: 3,
    });
    const high = designBandpass(2000, 6000, sr, 257, {
      windowType: 'kaiser',
      kaiserBeta: 12,
    });

    // Measure far into the stopband (well past any transition region)
    const attenLow = measureStopbandAttenuation(low, 100);
    const attenHigh = measureStopbandAttenuation(high, 100);

    // Higher β should give deeper rejection far from the passband
    expect(attenHigh).toBeLessThan(attenLow);
  });

  it('Kaiser filter preserves signal length when applied', () => {
    const coeffs = designBandpass(900, 2500, sr, 129, {
      windowType: 'kaiser',
      kaiserBeta: 8.6,
    });
    const signal = new Float32Array(4800);
    for (let i = 0; i < signal.length; i++) {
      signal[i] = Math.sin(2 * Math.PI * 1700 * i / sr);
    }
    const filtered = applyBandpass(signal, coeffs);
    expect(filtered.length).toBe(signal.length);
  });

  it('Kaiser filter passes in-band sinusoid', () => {
    const coeffs = designBandpass(900, 2500, sr, 129, {
      windowType: 'kaiser',
      kaiserBeta: 8.6,
    });
    const signal = new Float32Array(9600);
    for (let i = 0; i < signal.length; i++) {
      signal[i] = Math.sin(2 * Math.PI * 1700 * i / sr);
    }
    const filtered = applyBandpass(signal, coeffs);

    let maxAmp = 0;
    for (let i = 4800; i < filtered.length; i++) {
      maxAmp = Math.max(maxAmp, Math.abs(filtered[i]));
    }
    expect(maxAmp).toBeGreaterThan(0.8);
    expect(maxAmp).toBeLessThan(1.2);
  });
});
