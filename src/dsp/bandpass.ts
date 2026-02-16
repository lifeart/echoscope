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
 * Compute the zeroth-order modified Bessel function of the first kind, I₀(x).
 * Uses the series expansion I₀(x) = Σ [(x/2)^k / k!]² which converges
 * rapidly for the β values typical in Kaiser window design (β ≤ 14).
 */
function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const halfX = x / 2;
  for (let k = 1; k <= 25; k++) {
    term *= (halfX / k);
    const t2 = term * term;
    sum += t2;
    if (t2 < sum * 1e-16) break;
  }
  return sum;
}

/**
 * Generate a Kaiser window of length N with shape parameter β.
 *
 * Higher β → wider main lobe but lower sidelobes:
 *   β ≈ 0   → rectangular window (~−13 dB sidelobes)
 *   β ≈ 5   → ~−57 dB sidelobes (similar to Hamming)
 *   β ≈ 8.6 → ~−90 dB sidelobes
 *   β ≈ 14  → ~−120 dB sidelobes
 */
export function kaiserWindow(N: number, beta: number): Float32Array {
  const w = new Float32Array(N);
  const M = N - 1;
  const denominator = besselI0(beta);
  for (let n = 0; n < N; n++) {
    const arg = beta * Math.sqrt(1 - ((2 * n / M) - 1) ** 2);
    w[n] = besselI0(arg) / denominator;
  }
  return w;
}

export type WindowType = 'hann' | 'kaiser';

export interface BandpassOptions {
  /** Window type: 'hann' (default) or 'kaiser' */
  windowType?: WindowType;
  /** Kaiser β parameter (only used when windowType is 'kaiser').
   *  Default 8.6 ≈ −90 dB sidelobe level. */
  kaiserBeta?: number;
}

/**
 * Design a linear-phase FIR bandpass filter using windowed-sinc method.
 *
 * Supports Hann (default) and Kaiser windows. Kaiser provides tunable
 * sidelobe suppression via the β parameter, useful when sharper transition
 * bands are needed (e.g. for close-spaced multiplex carriers).
 *
 * @param fLow  Lower cutoff frequency (Hz)
 * @param fHigh Upper cutoff frequency (Hz)
 * @param sampleRate Sample rate (Hz)
 * @param numTaps Number of filter taps (must be odd; will be forced odd if even)
 * @param options Window type and Kaiser β (optional)
 */
export function designBandpass(
  fLow: number,
  fHigh: number,
  sampleRate: number,
  numTaps = 129,
  options: BandpassOptions = {},
): BandpassCoeffs {
  // Force odd length for symmetric (type I) linear-phase FIR
  if (numTaps % 2 === 0) numTaps++;
  const M = numTaps - 1; // filter order
  const half = M / 2;

  // Normalized cutoff frequencies (0 to 0.5)
  const wL = fLow / sampleRate;
  const wH = fHigh / sampleRate;

  const taps = new Float32Array(numTaps);

  // Pre-compute window coefficients
  const windowType = options.windowType ?? 'hann';
  const kaiserBeta = options.kaiserBeta ?? 8.6;
  const win = windowType === 'kaiser'
    ? kaiserWindow(numTaps, kaiserBeta)
    : null; // Hann computed inline below

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
    // Apply window
    const w = win ? win[n] : 0.5 * (1 - Math.cos(2 * Math.PI * n / M));
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
  if (coeffs.fLow >= coeffs.fHigh) return new Float32Array(signal);
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
