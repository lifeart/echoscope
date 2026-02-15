import { clamp } from '../utils.js';

export interface PeakResult {
  index: number;
  value: number;
}

export interface PeakAbsResult {
  index: number;
  value: number;
  absValue: number;
}

export interface ProfileBest {
  bin: number;
  val: number;
  range: number;
}

export function findPeak(a: Float32Array, start = 0, end = a.length): PeakResult {
  const s = clamp(start | 0, 0, a.length);
  const e = clamp(end | 0, s, a.length);
  if (e <= s) return { index: s, value: 0 };
  let bestI = s, bestV = -Infinity;
  for (let i = s; i < e; i++) {
    const v = a[i];
    if (v > bestV) { bestV = v; bestI = i; }
  }
  return { index: bestI, value: bestV };
}

export function findPeakAbs(a: Float32Array, start = 0, end = a.length): PeakAbsResult {
  const s = clamp(start | 0, 0, a.length);
  const e = clamp(end | 0, s, a.length);
  if (e <= s) return { index: s, value: 0, absValue: 0 };
  let bestI = s, bestV = -Infinity, bestRaw = 0;
  for (let i = s; i < e; i++) {
    const raw = a[i];
    const v = Math.abs(raw);
    if (v > bestV) { bestV = v; bestI = i; bestRaw = raw; }
  }
  return { index: bestI, value: bestRaw, absValue: bestV };
}

export function pickBestFromProfile(prof: Float32Array): { bin: number; val: number } {
  let bi = 0, bv = -Infinity;
  for (let i = 0; i < prof.length; i++) {
    const v = prof[i];
    if (v > bv) { bv = v; bi = i; }
  }
  return { bin: bi, val: bv };
}

export function estimateBestFromProfile(prof: Float32Array, minR: number, maxR: number): ProfileBest {
  const best = pickBestFromProfile(prof);
  if (best.val <= 1e-6) return { bin: -1, val: 0, range: NaN };
  if (!(Number.isFinite(minR) && Number.isFinite(maxR) && maxR > minR) || prof.length < 2) {
    return { bin: best.bin, val: best.val, range: NaN };
  }

  let peakPos = best.bin;
  if (best.bin > 0 && best.bin < prof.length - 1) {
    const y0 = prof[best.bin - 1];
    const y1 = prof[best.bin];
    const y2 = prof[best.bin + 1];
    const denom = y0 - 2 * y1 + y2;
    if (Math.abs(denom) > 1e-9) {
      const delta = 0.5 * (y0 - y2) / denom;
      if (Number.isFinite(delta) && Math.abs(delta) <= 1) peakPos = best.bin + delta;
    }
  }

  const range = minR + (peakPos / (prof.length - 1)) * (maxR - minR);
  return { bin: best.bin, val: best.val, range };
}
