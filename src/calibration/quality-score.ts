import { clamp } from '../utils.js';
import { QUALITY_WEIGHTS } from '../constants.js';

export interface CalibStats {
  tauMadL: number;
  tauMadR: number;
  peakL: number;
  peakR: number;
  geomErr: number;
  monoLikely: boolean;
}

/**
 * Compute calibration quality as a weighted combination of signal-quality
 * metrics (stability + correlation quality) and geometry fit.
 *
 * On distributed sources (laptop speakers), the point-source geometry model
 * is inherently violated, so geomErr can be large even with excellent signal
 * quality.  The geometry weight is kept modest (0.15) and capped softly so
 * geometry failure alone can't sink a stable, high-quality calibration below
 * the validity threshold.
 *
 * Mono penalty is mild (0.6x) because near-broadside sources can false-
 * positive on mono detection.  A truly mono device will also have poor
 * geometry and low TDOA variance, which independently reduce quality.
 */
export function computeCalibQuality(stats: CalibStats): number {
  const madMs = 1000 * Math.max(stats.tauMadL, stats.tauMadR);
  const madScore = clamp(1.0 - (madMs / 1.2), 0, 1);
  const peakScore = clamp((Math.min(stats.peakL, stats.peakR) - 0.10) / 0.25, 0, 1);
  // geomErr is 0 for valid geometry, >0 when triangle inequality fails
  // (normalized by rR², so 1.0 = y² deficit equals rR²)
  // Soft cap: geomErr > 2 all map to geomScore=0 (avoid over-penalizing
  // distributed sources where err can be very large)
  const geomScore = clamp(1.0 - stats.geomErr / 2.0, 0, 1);

  // Mono penalty: mild (0.6) — near-broadside sources frequently trigger
  // mono detection.  True mono devices fail via other metrics too.
  const monoPenalty = stats.monoLikely ? 0.6 : 1.0;

  return clamp(
    QUALITY_WEIGHTS.mad * madScore + QUALITY_WEIGHTS.peak * peakScore + QUALITY_WEIGHTS.geom * geomScore,
    0, 1
  ) * monoPenalty;
}
