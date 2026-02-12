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

export function computeCalibQuality(stats: CalibStats): number {
  const madMs = 1000 * Math.max(stats.tauMadL, stats.tauMadR);
  const madScore = clamp(1.0 - (madMs / 1.2), 0, 1);
  const peakScore = clamp((Math.min(stats.peakL, stats.peakR) - 0.10) / 0.25, 0, 1);
  // geomErr is 0 for valid geometry, >0 when triangle inequality fails
  // (normalized by rR², so 1.0 = y² deficit equals rR²)
  const geomScore = clamp(1.0 - stats.geomErr, 0, 1);
  const monoPenalty = stats.monoLikely ? 0.25 : 1.0;
  return clamp(
    QUALITY_WEIGHTS.mad * madScore + QUALITY_WEIGHTS.peak * peakScore + QUALITY_WEIGHTS.geom * geomScore,
    0, 1
  ) * monoPenalty;
}
