import type { QualityPerf } from '../types.js';
import { median } from '../utils.js';

export function median3Profile(src: Float32Array): Float32Array {
  const n = src.length;
  const out = new Float32Array(n);
  if (!n) return out;
  out[0] = src[0];
  for (let i = 1; i < n - 1; i++) {
    const a = src[i - 1], b = src[i], c = src[i + 1];
    out[i] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  }
  if (n > 1) out[n - 1] = src[n - 1];
  return out;
}

export function triSmoothProfile(src: Float32Array): Float32Array {
  const n = src.length;
  const out = new Float32Array(n);
  if (!n) return out;
  out[0] = src[0];
  for (let i = 1; i < n - 1; i++) out[i] = 0.25 * src[i - 1] + 0.5 * src[i] + 0.25 * src[i + 1];
  if (n > 1) out[n - 1] = src[n - 1];
  return out;
}

export function adaptiveFloorSuppressProfile(src: Float32Array): Float32Array {
  const n = src.length;
  const out = new Float32Array(n);
  const radius = 4;
  const floorScale = 0.9;
  for (let i = 0; i < n; i++) {
    let sum = 0, cnt = 0;
    const lo = Math.max(0, i - radius);
    const hi = Math.min(n - 1, i + radius);
    for (let j = lo; j <= hi; j++) { sum += src[j]; cnt++; }
    const floor = cnt > 0 ? sum / cnt : 0;
    const v = src[i] - floorScale * floor;
    out[i] = v > 0 ? v : 0;
  }
  return out;
}

export type QualityAlgoName = 'fast' | 'balanced' | 'max';

export interface ProfileQualityStats {
  peak: number;
  floor: number;
  psr: number;
  snrDb: number;
}

export interface ResolveAutoQualityOptions {
  enabled: boolean;
  hysteresisMs: number;
  lowPsr: number;
  highPsr: number;
}

export function computeProfileQualityStats(profile: Float32Array): ProfileQualityStats {
  if (profile.length === 0) {
    return { peak: 0, floor: 0, psr: 0, snrDb: -Infinity };
  }
  let peak = 0;
  for (let i = 0; i < profile.length; i++) {
    if (profile[i] > peak) peak = profile[i];
  }
  const floor = Math.max(1e-12, median(Array.from(profile)));
  const psr = peak / floor;
  const snrDb = 20 * Math.log10(Math.max(1e-12, psr));
  return { peak, floor, psr, snrDb };
}

export function resolveAutoQualityAlgo(
  profile: Float32Array,
  perf: QualityPerf,
  nowMs: number,
  options?: Partial<ResolveAutoQualityOptions>,
): { resolved: QualityAlgoName; stats: ProfileQualityStats; switched: boolean } {
  const opts: ResolveAutoQualityOptions = {
    enabled: true,
    hysteresisMs: 1200,
    lowPsr: 3,
    highPsr: 8,
    ...options,
  };

  const stats = computeProfileQualityStats(profile);
  if (!opts.enabled) return { resolved: 'balanced', stats, switched: false };

  const current = (perf.lastResolved === 'fast' || perf.lastResolved === 'balanced' || perf.lastResolved === 'max')
    ? perf.lastResolved
    : 'balanced';

  let target: QualityAlgoName = current;
  if (current === 'max') {
    target = (stats.psr > opts.lowPsr + 1 && stats.snrDb > 16) ? 'balanced' : 'max';
  } else if (current === 'fast') {
    target = (stats.psr < opts.highPsr - 1 || stats.snrDb < 24) ? 'balanced' : 'fast';
  } else {
    if (stats.psr < opts.lowPsr - 0.5 || stats.snrDb < 10) target = 'max';
    else if (stats.psr > opts.highPsr + 1 && stats.snrDb > 32) target = 'fast';
    else target = 'balanced';
  }

  if (target === current) return { resolved: current, stats, switched: false };

  const elapsed = nowMs - perf.lastSwitchAt;
  if (elapsed < opts.hysteresisMs) {
    return { resolved: current, stats, switched: false };
  }
  return { resolved: target, stats, switched: true };
}

export function applyQualityAlgorithms(profile: Float32Array, algo: QualityAlgoName): Float32Array {
  if (algo === 'fast') return new Float32Array(profile);
  let out = median3Profile(profile);
  out = triSmoothProfile(out);
  if (algo === 'max') {
    out = adaptiveFloorSuppressProfile(out);
    out = triSmoothProfile(out);
  }
  return out;
}
