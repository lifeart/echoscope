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
  const winSec = 0.006 + 0.010 * (1.0 - lockStrength);
  const win = Math.floor(sampleRate * winSec);
  const start = clamp(center - win, 0, corr.length);
  const end = clamp(center + win, 0, corr.length);

  if (end - start < 64) {
    const dp = findPeakAbs(corr, 0, earlyEnd);
    return dp.index / sampleRate;
  }

  const dp = findPeakAbs(corr, start, end);
  const fb = findPeakAbs(corr, 0, earlyEnd);
  if (fb.absValue > 1e-12 && dp.absValue < 0.1 * fb.absValue) {
    return fb.index / sampleRate;
  }

  return dp.index / sampleRate;
}
