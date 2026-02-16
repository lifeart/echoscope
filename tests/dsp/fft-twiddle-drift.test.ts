/**
 * Tests for Fix #1: FFT twiddle factor periodic reset.
 *
 * Verifies that the periodic recomputation of twiddle factors from
 * cos/sin (every TWIDDLE_RESET iterations) prevents floating-point
 * drift at large FFT sizes, preserving Golay sidelobe cancellation.
 */
import { describe, it, expect } from 'vitest';
import { fft, ifft, nextPow2 } from '../../src/dsp/fft.js';

describe('FFT twiddle drift prevention', () => {
  it('roundtrip at N=65536 has low error', () => {
    const N = 65536;
    const real = new Float32Array(N);
    const imag = new Float32Array(N);

    // Create a signal with multiple frequency components
    for (let i = 0; i < N; i++) {
      real[i] = Math.sin(2 * Math.PI * 100 * i / N) +
                0.5 * Math.cos(2 * Math.PI * 3000 * i / N) +
                0.3 * Math.sin(2 * Math.PI * 15000 * i / N);
    }
    const origReal = new Float32Array(real);

    fft(real, imag);
    ifft(real, imag);

    let maxErr = 0;
    for (let i = 0; i < N; i++) {
      const err = Math.abs(real[i] - origReal[i]);
      if (err > maxErr) maxErr = err;
    }
    // With twiddle reset, error stays below ~1e-5 even at large N
    expect(maxErr).toBeLessThan(1e-4);
  });

  it('preserves Golay sidelobe cancellation at large N', () => {
    // Golay pair: A and B sequences where autocorr(A) + autocorr(B) = 2N·δ(0)
    // If twiddle drift is too large, the sidelobe cancellation degrades.
    const N = 1024;
    const padN = nextPow2(2 * N);

    // Simple Golay pair of length 2: A=[1,1], B=[1,-1]
    // Extended to length N by zero-padding
    const aReal = new Float32Array(padN);
    const aImag = new Float32Array(padN);
    const bReal = new Float32Array(padN);
    const bImag = new Float32Array(padN);

    aReal[0] = 1; aReal[1] = 1;
    bReal[0] = 1; bReal[1] = -1;

    // Compute |FFT(A)|^2 + |FFT(B)|^2 — should be constant = 2*2 = 4
    fft(aReal, aImag);
    fft(bReal, bImag);

    let maxDeviation = 0;
    for (let k = 0; k < padN; k++) {
      const powA = aReal[k] * aReal[k] + aImag[k] * aImag[k];
      const powB = bReal[k] * bReal[k] + bImag[k] * bImag[k];
      const sum = powA + powB;
      const dev = Math.abs(sum - 4);
      if (dev > maxDeviation) maxDeviation = dev;
    }
    expect(maxDeviation).toBeLessThan(1e-6);
  });

  it('FFT of pure tone yields single peak with correct magnitude', () => {
    const N = 4096;
    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    const binFreq = 100;

    for (let i = 0; i < N; i++) {
      real[i] = Math.cos(2 * Math.PI * binFreq * i / N);
    }

    fft(real, imag);

    // Bin 100 should have magnitude N/2
    const expected = N / 2;
    const mag = Math.sqrt(real[binFreq] ** 2 + imag[binFreq] ** 2);
    expect(Math.abs(mag - expected)).toBeLessThan(1e-3);

    // All other bins (far from DC and Nyquist mirror) should be near zero
    for (let k = 2; k < N / 2; k++) {
      if (k === binFreq) continue;
      const m = Math.sqrt(real[k] ** 2 + imag[k] ** 2);
      expect(m).toBeLessThan(1e-3);
    }
  });
});
