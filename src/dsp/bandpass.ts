import { fft, ifft, nextPow2, zeroPad } from './fft.js';

/**
 * Pre-computed FIR bandpass filter coefficients.
 * Linear-phase (symmetric) so group delay is constant = (taps-1)/2 samples.
 * Identical coefficients on L and R preserves deltaTau exactly.
 */
export interface BandpassCoeffs {
  /** Filter tap coefficients (symmetric, odd length) */
  taps: Float32Array;
  /** Group delay in samples: (taps.length - 1) / 2 */
  groupDelay: number;
  /** Lower cutoff frequency (Hz) */
  fLow: number;
  /** Upper cutoff frequency (Hz) */
  fHigh: number;
  /** Sample rate these coefficients were designed for */
  sampleRate: number;
}

/**
 * Design a linear-phase FIR bandpass filter using windowed-sinc method
 * with a Hann window.
 *
 * @param fLow  Lower cutoff frequency (Hz)
 * @param fHigh Upper cutoff frequency (Hz)
 * @param sampleRate Sample rate (Hz)
 * @param numTaps Number of filter taps (must be odd; will be forced odd if even)
 */
export function designBandpass(
  fLow: number,
  fHigh: number,
  sampleRate: number,
  numTaps = 129,
): BandpassCoeffs {
  // Force odd length for symmetric (type I) linear-phase FIR
  if (numTaps % 2 === 0) numTaps++;
  const M = numTaps - 1; // filter order
  const half = M / 2;

  // Normalized cutoff frequencies (0 to 0.5)
  const wL = fLow / sampleRate;
  const wH = fHigh / sampleRate;

  const taps = new Float32Array(numTaps);

  // Windowed-sinc bandpass: difference of two lowpass sinc filters
  for (let n = 0; n < numTaps; n++) {
    const x = n - half;
    let h: number;
    if (Math.abs(x) < 1e-10) {
      // At center: limit of sinc difference
      h = 2 * (wH - wL);
    } else {
      // sinc(2*wH*x) - sinc(2*wL*x)
      h = (Math.sin(2 * Math.PI * wH * x) - Math.sin(2 * Math.PI * wL * x)) / (Math.PI * x);
    }
    // Hann window
    const w = 0.5 * (1 - Math.cos(2 * Math.PI * n / M));
    taps[n] = h * w;
  }

  // Normalize: ensure unity gain at center frequency
  const fCenter = (fLow + fHigh) / 2;
  let sumReal = 0;
  for (let n = 0; n < numTaps; n++) {
    sumReal += taps[n] * Math.cos(2 * Math.PI * (fCenter / sampleRate) * (n - half));
  }
  if (Math.abs(sumReal) > 1e-12) {
    const inv = 1 / sumReal;
    for (let n = 0; n < numTaps; n++) taps[n] *= inv;
  }

  return {
    taps,
    groupDelay: half,
    fLow,
    fHigh,
    sampleRate,
  };
}

/**
 * Apply FIR bandpass filter to a signal using FFT convolution.
 * Returns filtered signal with same length as input (group-delay compensated).
 */
export function applyBandpass(signal: Float32Array, coeffs: BandpassCoeffs): Float32Array {
  const sigLen = signal.length;
  const tapLen = coeffs.taps.length;
  const convLen = sigLen + tapLen - 1;
  const N = nextPow2(convLen);

  // FFT of signal
  const xReal = zeroPad(signal, N);
  const xImag = new Float32Array(N);
  fft(xReal, xImag);

  // FFT of filter taps
  const hReal = zeroPad(coeffs.taps, N);
  const hImag = new Float32Array(N);
  fft(hReal, hImag);

  // Multiply in frequency domain
  const outReal = new Float32Array(N);
  const outImag = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    outReal[i] = xReal[i] * hReal[i] - xImag[i] * hImag[i];
    outImag[i] = xReal[i] * hImag[i] + xImag[i] * hReal[i];
  }

  ifft(outReal, outImag);

  // Extract output, compensating for group delay (linear-phase FIR)
  const delay = coeffs.groupDelay;
  const result = new Float32Array(sigLen);
  for (let i = 0; i < sigLen; i++) {
    const srcIdx = i + delay;
    result[i] = srcIdx < convLen ? outReal[srcIdx] : 0;
  }

  return result;
}
