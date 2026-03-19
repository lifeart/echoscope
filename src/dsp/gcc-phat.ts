import { fft, ifft, nextPow2, zeroPad } from './fft.js';

export interface GCCResult {
  gcc: Float32Array;
  peakDelay: number;
  confidence: number;
}

/**
 * Generalized Cross-Correlation with Phase Transform (GCC-PHAT).
 *
 * Computes G12 = conj(X1) · X2 / |conj(X1) · X2|, then IFFT.
 *
 * Sign convention: a *positive* peakDelay means sig2 is *delayed*
 * relative to sig1 (i.e. sig1 arrives first).  When used for DOA
 * with mic-pair (i, j), a positive delay means the wavefront reaches
 * mic[i] before mic[j].
 */
export function gccPhat(sig1: Float32Array, sig2: Float32Array, sampleRate: number): GCCResult {
  const L = sig1.length + sig2.length - 1;
  const N = nextPow2(L);

  const r1 = zeroPad(sig1, N);
  const i1 = new Float32Array(N);
  const r2 = zeroPad(sig2, N);
  const i2 = new Float32Array(N);

  fft(r1, i1);
  fft(r2, i2);

  // Cross-power spectrum with PHAT weighting
  const outR = new Float32Array(N);
  const outI = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    // G12 = conj(X1) * X2
    const gR = r1[k] * r2[k] + i1[k] * i2[k];
    const gI = r1[k] * i2[k] - i1[k] * r2[k];
    const mag = Math.sqrt(gR * gR + gI * gI);
    if (mag > 1e-12) {
      outR[k] = gR / mag;
      outI[k] = gI / mag;
    }
  }

  ifft(outR, outI);

  // Find peak in the GCC output
  let peakIdx = 0;
  let peakVal = -Infinity;
  for (let i = 0; i < N; i++) {
    if (outR[i] > peakVal) {
      peakVal = outR[i];
      peakIdx = i;
    }
  }

  // Convert index to delay (handle wrap-around)
  const delaySamples = peakIdx <= N / 2 ? peakIdx : peakIdx - N;
  const peakDelay = delaySamples / sampleRate;

  // Confidence: energy concentration ratio (size-independent).
  // peakVal^2 / sum(gcc^2) measures what fraction of total energy is in the peak.
  let sumSquared = 0;
  for (let i = 0; i < N; i++) sumSquared += outR[i] * outR[i];
  const confidence = sumSquared > 1e-24 ? (peakVal * peakVal) / sumSquared : 0;

  return { gcc: outR, peakDelay, confidence: Math.min(1, confidence) };
}
