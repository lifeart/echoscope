import type { TargetState } from '../types.js';
import { clamp } from '../utils.js';

export type RangePriorSource = 'track' | 'last-target' | 'mid-range';

export interface RangePrior {
  center: number;
  sigma: number;
  source: RangePriorSource;
}

export interface RangePeakCandidate {
  bin: number;
  value: number;
  range: number;
}

export interface MapPeakSelection extends RangePeakCandidate {
  score: number;
  zScore: number;
}

function selectBestTrack(targets: TargetState[]): TargetState | null {
  let best: TargetState | null = null;
  for (const target of targets) {
    if (!Number.isFinite(target.position.range)) continue;
    if (target.missCount > 4) continue;
    if (!best) {
      best = target;
      continue;
    }
    if (target.missCount < best.missCount) {
      best = target;
      continue;
    }
    if (target.missCount === best.missCount && target.confidence > best.confidence) {
      best = target;
    }
  }
  return best;
}

export function buildRangePrior(
  targets: TargetState[],
  lastTargetRange: number,
  minRange: number,
  maxRange: number,
): RangePrior | null {
  if (!Number.isFinite(minRange) || !Number.isFinite(maxRange) || maxRange <= minRange) return null;
  const span = maxRange - minRange;

  const track = selectBestTrack(targets);
  if (track) {
    // Derive sigma from the Kalman filter's own range covariance (P[0]).
    // This adapts the prior width to the actual track uncertainty rather
    // than using a fixed fraction of the range window.
    const kalmanRangeVar = track.covariance[0];  // P[0,0] = range variance
    const kalmanSigma = Number.isFinite(kalmanRangeVar) && kalmanRangeVar > 0
      ? Math.sqrt(kalmanRangeVar)
      : span * 0.14;
    return {
      center: clamp(track.position.range, minRange, maxRange),
      sigma: clamp(kalmanSigma, 0.10, 1.2 + 0.3 * track.missCount),
      source: 'track',
    };
  }

  if (Number.isFinite(lastTargetRange)) {
    return {
      center: clamp(lastTargetRange, minRange, maxRange),
      sigma: clamp(span * 0.20, 0.35, 0.90),
      source: 'last-target',
    };
  }

  return {
    center: minRange + 0.5 * span,
    sigma: Math.max(0.8, span * 0.42),
    source: 'mid-range',
  };
}

export function selectPeakWithRangePrior(
  peaks: RangePeakCandidate[],
  prior: RangePrior | null,
): MapPeakSelection | null {
  if (peaks.length === 0 || !prior) return null;

  const sigma = Math.max(1e-6, prior.sigma);
  let best: MapPeakSelection | null = null;

  for (const peak of peaks) {
    if (!(peak.value > 0) || !Number.isFinite(peak.range)) continue;
    const z = (peak.range - prior.center) / sigma;
    const score = Math.log(Math.max(1e-12, peak.value)) - 0.5 * z * z;
    if (!best || score > best.score) {
      best = {
        ...peak,
        score,
        zScore: Math.abs(z),
      };
    }
  }

  return best;
}
