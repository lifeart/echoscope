import { state } from './state.js';
import { clamp } from './utils.js';

export function correlate(x, s) {
  const Nx = x.length, Ns = s.length;
  if (Nx <= 0 || Ns <= 0 || Nx < Ns) return new Float32Array(0);
  const L = Nx - Ns + 1;
  const out = new Float32Array(L);
  for (let tau = 0; tau < L; tau++) {
    let acc = 0;
    for (let i = 0; i < Ns; i++) acc += x[tau + i] * s[i];
    out[tau] = acc;
  }
  return out;
}

export function absMaxNormalize(a) {
  let mx = 0;
  for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > mx) mx = v; }
  if (mx <= 1e-12) return a;
  const inv = 1 / mx;
  for (let i = 0; i < a.length; i++) a[i] *= inv;
  return a;
}

export function findPeak(a, start = 0, end = a.length) {
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

export function findPeakAbs(a, start = 0, end = a.length) {
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

export function findDirectPathTau(corr, predictedTau0SecOrNull, lockStrength) {
  const earlyEnd = Math.min(corr.length, Math.floor(state.sr * 0.060));
  if (predictedTau0SecOrNull === null || !Number.isFinite(predictedTau0SecOrNull) || lockStrength <= 0) {
    const dp = findPeakAbs(corr, 0, earlyEnd);
    return dp.index / state.sr;
  }
  const center = Math.floor(predictedTau0SecOrNull * state.sr);
  const winSec = 0.006 + 0.010 * (1.0 - lockStrength);
  const win = Math.floor(state.sr * winSec);
  const start = clamp(center - win, 0, corr.length);
  const end = clamp(center + win, 0, corr.length);
  if (end - start < 64) {
    const dp = findPeakAbs(corr, 0, earlyEnd);
    return dp.index / state.sr;
  }
  const dp = findPeakAbs(corr, start, end);
  if (dp.absValue < 0.06) {
    const fb = findPeakAbs(corr, 0, earlyEnd);
    return fb.index / state.sr;
  }
  return dp.index / state.sr;
}

export function pickBestFromProfile(prof) {
  let bi = 0, bv = -Infinity;
  for (let i = 0; i < prof.length; i++) {
    const v = prof[i];
    if (v > bv) { bv = v; bi = i; }
  }
  return { bin: bi, val: (bv < 0 ? 0 : bv) };
}

export function estimateBestFromProfile(prof, minR, maxR) {
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

export function buildRangeProfileFromCorrelation(corr, tau0, c, minR, maxR) {
  const prof = new Float32Array(state.heatBins);
  prof.fill(0);

  if (!corr || corr.length === 0) return prof;
  if (!(Number.isFinite(c) && c > 0 && Number.isFinite(minR) && Number.isFinite(maxR) && maxR > minR)) return prof;

  const minTau = (2 * minR) / c;
  const maxTau = (2 * maxR) / c;

  for (let i = 0; i < corr.length; i++) {
    const tau = (i / state.sr) - tau0;
    if (tau < minTau || tau > maxTau) continue;
    const R = (c * tau) / 2;
    const binPos = ((R - minR) / (maxR - minR)) * (state.heatBins - 1);
    const bin = clamp(Math.floor(binPos), 0, state.heatBins - 1);
    const v = Math.abs(corr[i]);
    if (v > prof[bin]) prof[bin] = v;
  }

  return prof;
}

export function estimateMicXY(rL, rR, d) {
  const x = (rL * rL - rR * rR) / (2 * d);
  const y2 = rL * rL - (x + d / 2) * (x + d / 2);
  const y = Math.sqrt(Math.max(0, y2));
  const y2b = rR * rR - (x - d / 2) * (x - d / 2);
  const err = Math.abs(y2 - y2b);
  return { x, y, err };
}
