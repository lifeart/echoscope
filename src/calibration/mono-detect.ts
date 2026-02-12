import type { MonoAssessment } from '../types.js';
import { MONO_THRESHOLDS } from '../constants.js';

/**
 * Assess whether the device is likely producing mono output (both speakers
 * driven identically).
 *
 * Mono detection must avoid broadside false-positives: a source near 0°
 * produces small dt even with true stereo separation.  We use a relative
 * TDOA threshold (dt must be < 10% of physical max TDOA for the spacing)
 * in addition to the absolute threshold, and require that the peak
 * amplitudes also be nearly identical.
 */
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
  const maxTDOA = d / c; // physical limit for this spacing

  // Absolute threshold: dt must be very small
  const monoByTime = dt < MONO_THRESHOLDS.timeSec;

  // Relative threshold: dt must also be < 10% of max physical TDOA
  // This prevents broadside false-positives (where dt is small but real)
  const monoByRelTime = maxTDOA > 0 ? (dt / maxTDOA) < 0.10 : true;

  const monoByPeak = dp < MONO_THRESHOLDS.peakDiff;
  const expectDiff = maxTDOA > MONO_THRESHOLDS.expectDiffSec;

  // Require ALL conditions: absolute time, relative time, peak similarity,
  // and spacing large enough to expect a difference
  const monoLikely = monoByTime && monoByRelTime && monoByPeak && expectDiff;
  return { dt, dp, monoByTime, monoByRelTime, monoByPeak, expectDiff, monoLikely };
}
