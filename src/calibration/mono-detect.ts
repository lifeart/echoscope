import type { MonoAssessment } from '../types.js';
import { MONO_THRESHOLDS } from '../constants.js';

export function assessMonoDecision(
  tauL: number,
  tauR: number,
  peakL: number,
  peakR: number,
  d: number,
  c: number,
): MonoAssessment {
  const dt = Math.abs(tauL - tauR);
  const dp = Math.abs(peakL - peakR);
  const monoByTime = dt < MONO_THRESHOLDS.timeSec;
  const monoByPeak = dp < MONO_THRESHOLDS.peakDiff;
  const expectDiff = (d / c) > MONO_THRESHOLDS.expectDiffSec;
  const monoLikely = monoByTime && monoByPeak && expectDiff;
  return { dt, dp, monoByTime, monoByPeak, expectDiff, monoLikely };
}
