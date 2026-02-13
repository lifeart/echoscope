import { clamp } from '../utils.js';
import { findPeakAbs } from '../dsp/peak.js';

export function findDirectPathTau(
  corr: Float32Array,
  predictedTau0SecOrNull: number | null,
  lockStrength: number,
  sampleRate: number,
): number {
  const earlyEnd = Math.min(corr.length, Math.floor(sampleRate * 0.060));

  if (predictedTau0SecOrNull === null || !Number.isFinite(predictedTau0SecOrNull) || lockStrength <= 0) {
    const dp = findPeakAbs(corr, 0, earlyEnd);
    return dp.index / sampleRate;
  }

  const center = Math.floor(predictedTau0SecOrNull * sampleRate);
  const sigmaSec = 0.003 + 0.013 * (1.0 - lockStrength);
  const sigma = Math.max(1, Math.floor(sampleRate * sigmaSec));
  const searchRadius = 3 * sigma;
  const start = clamp(center - searchRadius, 0, corr.length);
  const end = clamp(center + searchRadius, 0, corr.length);

  if (end - start < 64) {
    const dp = findPeakAbs(corr, 0, earlyEnd);
    return dp.index / sampleRate;
  }

  // Gaussian-weighted peak search
  const invTwoSigmaSq = 1 / (2 * sigma * sigma);
  let bestI = start, bestWeightedVal = -Infinity;
  for (let i = start; i < end; i++) {
    const dist = i - center;
    const w = Math.exp(-dist * dist * invTwoSigmaSq);
    const wv = Math.abs(corr[i]) * w;
    if (wv > bestWeightedVal) { bestWeightedVal = wv; bestI = i; }
  }

  const fb = findPeakAbs(corr, 0, earlyEnd);
  if (fb.absValue > 1e-12 && Math.abs(corr[bestI]) < 0.1 * fb.absValue) {
    return fb.index / sampleRate;
  }

  return bestI / sampleRate;
}
