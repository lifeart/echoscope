import { signalEnergy } from '../utils.js';

export interface CorrelationEvidence {
  peakNorm: number;
  medianNorm: number;
  prominence: number;
  peakIndex: number;
  /** Number of consecutive samples near the peak above half-maximum.
   *  Real probe signals produce wide peaks (≥ 1/BW samples);
   *  random noise produces narrow 1–2 sample spikes. */
  peakWidth: number;
  pass: boolean;
}

interface CorrelationEvidenceOptions {
  minPeakNorm?: number;
  minProminence?: number;
  strongPeakNorm?: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? 0.5 * (sorted[mid - 1] + sorted[mid])
    : sorted[mid];
}

export function estimateCorrelationEvidence(
  corr: Float32Array,
  signal: Float32Array,
  reference: Float32Array,
  options?: CorrelationEvidenceOptions,
): CorrelationEvidence {
  const minPeakNorm = options?.minPeakNorm ?? 0.040;
  const minProminence = options?.minProminence ?? 3.5;
  const strongPeakNorm = options?.strongPeakNorm ?? 0.055;

  const refLen = reference.length;
  const validLen = Math.min(corr.length, Math.max(0, signal.length - refLen + 1));
  const refEnergy = signalEnergy(reference);
  if (validLen <= 0 || refLen <= 0 || refEnergy <= 1e-12) {
    return { peakNorm: 0, medianNorm: 0, prominence: 0, peakIndex: -1, peakWidth: 0, pass: false };
  }

  const prefix = new Float64Array(signal.length + 1);
  for (let i = 0; i < signal.length; i++) {
    const v = signal[i];
    prefix[i + 1] = prefix[i] + v * v;
  }

  const norms: number[] = new Array(validLen);
  let peakNorm = 0;
  let peakIndex = -1;
  for (let i = 0; i < validLen; i++) {
    const winEnergy = prefix[i + refLen] - prefix[i];
    const denom = Math.sqrt(Math.max(1e-12, refEnergy * winEnergy));
    const norm = Math.abs(corr[i]) / denom;
    norms[i] = norm;
    if (norm > peakNorm) {
      peakNorm = norm;
      peakIndex = i;
    }
  }

  // Measure correlation-peak width at half-maximum.
  // Real probe signals (chirp, Golay, MLS) produce wide compressed pulses
  // with width ≈ 1/BW (e.g. 7 samples for a 7 kHz-bandwidth chirp at 48 kHz).
  // Random noise produces narrow 1–2 sample spikes that fail this check.
  const halfMax = peakNorm * 0.5;
  let peakWidth = 1;
  for (let j = peakIndex - 1; j >= 0 && norms[j] >= halfMax; j--) peakWidth++;
  for (let j = peakIndex + 1; j < validLen && norms[j] >= halfMax; j++) peakWidth++;

  const medianNorm = Math.max(1e-9, median(norms));
  const prominence = peakNorm / medianNorm;

  // Strong signal: bypass all other checks.
  // Weak signal: must pass peakNorm AND prominence gates.
  // minPeakNorm is set to 0.040 — above typical noise peakNorm range (0.020–0.040)
  // for short references.  With longer probes (20 ms chirp → refLen 960),
  // refEnergy grows ~3×, shrinking peakNorm while prominence stays high.
  // The highProminence path catches this: prominence ≥ 12 (noise range 5–8)
  // with a minimal-floor peakNorm ≥ 0.005 to reject silence.
  const highProminence = 12;
  const minPeakFloor = 0.005;
  const pass = peakNorm >= strongPeakNorm
    || (peakNorm >= minPeakNorm && prominence >= minProminence)
    || (prominence >= highProminence && peakNorm >= minPeakFloor);

  return { peakNorm, medianNorm, prominence, peakIndex, peakWidth, pass };
}
