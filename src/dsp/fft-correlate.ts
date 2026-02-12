import { fft, ifft, nextPow2, zeroPad } from './fft.js';
import type { CorrelationResult } from '../types.js';

export function fftCorrelate(signal: Float32Array, reference: Float32Array, _sampleRate: number): CorrelationResult {
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
  const correlation = new Float32Array(Math.max(0, validLen));
  for (let i = 0; i < correlation.length; i++) {
    correlation[i] = outReal[i];
  }

  return { correlation, tau0: 0, method: 'fft' };
}
