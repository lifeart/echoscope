import { fft, ifft, nextPow2, zeroPad } from './fft.js';
import type { CorrelationResult } from '../types.js';

export interface ComplexCorrelationResult extends CorrelationResult {
  correlationImag: Float32Array;
}

export function fftCorrelateComplex(signal: Float32Array, reference: Float32Array, _sampleRate: number): ComplexCorrelationResult {
  if (signal.length === 0 || reference.length === 0 || signal.length < reference.length) {
    return {
      correlation: new Float32Array(0),
      correlationImag: new Float32Array(0),
      tau0: 0,
      method: 'fft',
    };
  }
  const L = signal.length + reference.length - 1;
  const N = nextPow2(L);

  const xReal = zeroPad(signal, N);
  const xImag = new Float32Array(N);
  const sReal = zeroPad(reference, N);
  const sImag = new Float32Array(N);

  fft(xReal, xImag);
  fft(sReal, sImag);

  // Multiply X * conj(S)
  const outReal = new Float32Array(N);
  const outImag = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    outReal[i] = xReal[i] * sReal[i] + xImag[i] * sImag[i];
    outImag[i] = xImag[i] * sReal[i] - xReal[i] * sImag[i];
  }

  ifft(outReal, outImag);

  // Extract valid region (same as time-domain correlate output length)
  const validLen = signal.length - reference.length + 1;
  const valid = Math.max(0, validLen);
  const correlation = new Float32Array(valid);
  const correlationImag = new Float32Array(valid);
  for (let i = 0; i < correlation.length; i++) {
    correlation[i] = outReal[i];
    correlationImag[i] = outImag[i];
  }

  return { correlation, correlationImag, tau0: 0, method: 'fft' };
}

export function fftCorrelate(signal: Float32Array, reference: Float32Array, sampleRate: number): CorrelationResult {
  const out = fftCorrelateComplex(signal, reference, sampleRate);
  return { correlation: out.correlation, tau0: 0, method: 'fft' };
}
