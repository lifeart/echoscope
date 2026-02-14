import { signalEnergy } from '../utils.js';

export interface CorrelationEvidence {
  peakNorm: number;
  medianNorm: number;
  prominence: number;
  peakIndex: number;
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
  const minPeakNorm = options?.minPeakNorm ?? 0.030;
  const minProminence = options?.minProminence ?? 1.8;
  const strongPeakNorm = options?.strongPeakNorm ?? 0.055;

  const refLen = reference.length;
  const validLen = Math.min(corr.length, Math.max(0, signal.length - refLen + 1));
  const refEnergy = signalEnergy(reference);
  if (validLen <= 0 || refLen <= 0 || refEnergy <= 1e-12) {
    return { peakNorm: 0, medianNorm: 0, prominence: 0, peakIndex: -1, pass: false };
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

  const medianNorm = Math.max(1e-9, median(norms));
  const prominence = peakNorm / medianNorm;
  const pass = peakNorm >= strongPeakNorm || (peakNorm >= minPeakNorm && prominence >= minProminence);

  return { peakNorm, medianNorm, prominence, peakIndex, pass };
}
