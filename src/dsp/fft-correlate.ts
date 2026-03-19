import { fft, ifft, nextPow2 } from './fft.js';
import type { CorrelationResult } from '../types.js';

export interface ComplexCorrelationResult extends CorrelationResult {
  correlationImag: Float32Array;
}

interface CorrelateBuffers {
  xR: Float32Array;
  xI: Float32Array;
  sR: Float32Array;
  sI: Float32Array;
  oR: Float32Array;
  oI: Float32Array;
}

const bufferPool = new Map<number, CorrelateBuffers>();

function getBuffers(N: number): CorrelateBuffers {
  let b = bufferPool.get(N);
  if (!b) {
    b = {
      xR: new Float32Array(N),
      xI: new Float32Array(N),
      sR: new Float32Array(N),
      sI: new Float32Array(N),
      oR: new Float32Array(N),
      oI: new Float32Array(N),
    };
    bufferPool.set(N, b);
  }
  // Zero out before reuse
  b.xR.fill(0); b.xI.fill(0); b.sR.fill(0); b.sI.fill(0); b.oR.fill(0); b.oI.fill(0);
  return b;
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

  const buf = getBuffers(N);
  const xReal = buf.xR;
  const xImag = buf.xI;
  const sReal = buf.sR;
  const sImag = buf.sI;

  // Copy signal and reference into pooled buffers (already zeroed)
  for (let i = 0; i < signal.length; i++) xReal[i] = signal[i];
  for (let i = 0; i < reference.length; i++) sReal[i] = reference[i];

  fft(xReal, xImag);
  fft(sReal, sImag);

  // Multiply X * conj(S) into pooled output buffers
  const outReal = buf.oR;
  const outImag = buf.oI;
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
