import { clamp } from '../utils.js';
import { findPeakAbs } from '../dsp/peak.js';

export function findDirectPathTau(
  corr: Float32Array,
  predictedTau0SecOrNull: number | null,
  lockStrength: number,
  sampleRate: number,
): number {
  const earlyEnd = Math.min(corr.length, Math.floor(sampleRate * 0.060));
  const lock = clamp(lockStrength, 0, 1);

  if (predictedTau0SecOrNull === null || !Number.isFinite(predictedTau0SecOrNull) || lock <= 0) {
    const dp = findPeakAbs(corr, 0, earlyEnd);
    return dp.index / sampleRate;
  }

  const center = Math.floor(clamp(predictedTau0SecOrNull * sampleRate, 0, earlyEnd - 1));
  const sigmaSec = 0.0006 + 0.0065 * (1.0 - lock);
  const sigma = Math.max(1, Math.floor(sampleRate * sigmaSec));
  const searchRadius = 3 * sigma;
  const start = clamp(center - searchRadius, 0, earlyEnd);
  const end = clamp(center + searchRadius, 0, earlyEnd);

  if (end - start < 64) {
    const dp = findPeakAbs(corr, 0, earlyEnd);
    return dp.index / sampleRate;
  }

  // MAP-like weighted search around prediction:
  // maximize log(|corr| + eps) - (tau - pred)^2 / (2*sigma^2)
  const invTwoSigmaSq = 1 / (2 * sigma * sigma);
  let bestI = start;
  let bestScore = -Infinity;
  for (let i = start; i < end; i++) {
    const dist = i - center;
    const absVal = Math.abs(corr[i]);
    const score = Math.log(absVal + 1e-12) - dist * dist * invTwoSigmaSq;
    if (score > bestScore) {
      bestScore = score;
      bestI = i;
    }
  }

  const fb = findPeakAbs(corr, 0, earlyEnd);
  const minLocalRatio = 0.02 + 0.08 * (1 - lock);
  if (fb.absValue > 1e-12 && Math.abs(corr[bestI]) < minLocalRatio * fb.absValue) {
    return fb.index / sampleRate;
  }

  return bestI / sampleRate;
}
