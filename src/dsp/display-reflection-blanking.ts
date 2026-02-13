import { clamp } from '../utils.js';
import type { DisplayReflectionBlankingConfig } from '../types.js';

const EPS = 1e-9;

function attenuationFactorAtRange(
  range: number,
  startRange: number,
  endRange: number,
  attenuation: number,
  edgeSoftness: number,
): number {
  const target = 1 - attenuation;
  const soft = Math.max(0, edgeSoftness);

  if (soft <= EPS) {
    return range >= startRange && range <= endRange ? target : 1;
  }

  const leftStart = startRange - soft;
  const leftEnd = startRange + soft;
  const rightStart = endRange - soft;
  const rightEnd = endRange + soft;

  if (range <= leftStart || range >= rightEnd) return 1;
  if (range >= leftEnd && range <= rightStart) return target;

  if (range < leftEnd) {
    const t = clamp((range - leftStart) / Math.max(EPS, leftEnd - leftStart), 0, 1);
    return 1 + (target - 1) * t;
  }

  const t = clamp((range - rightStart) / Math.max(EPS, rightEnd - rightStart), 0, 1);
  return target + (1 - target) * t;
}

export function applyDisplayReflectionBlanking(
  profile: Float32Array,
  minRange: number,
  maxRange: number,
  cfg: DisplayReflectionBlankingConfig,
): Float32Array {
  if (!cfg.enabled || profile.length === 0 || cfg.attenuation <= 0) return profile;

  const lo = Math.min(minRange, maxRange);
  const hi = Math.max(minRange, maxRange);
  const startRange = clamp(Math.min(cfg.startRange, cfg.endRange), lo, hi);
  const endRange = clamp(Math.max(cfg.startRange, cfg.endRange), lo, hi);

  if (endRange <= startRange + EPS) return profile;

  const out = new Float32Array(profile.length);
  const denom = Math.max(1, profile.length - 1);
  const span = hi - lo;

  for (let i = 0; i < profile.length; i++) {
    const t = i / denom;
    const range = lo + span * t;
    const factor = attenuationFactorAtRange(range, startRange, endRange, cfg.attenuation, cfg.edgeSoftness);
    out[i] = profile[i] * factor;
  }

  return out;
}
