import { state } from './state.js';
import { clamp } from './utils.js';
import { el, log } from './dom.js';
import { absMaxNormalize } from './dsp.js';

export function getStrengthGate() {
  const raw = parseFloat(el("strengthGate").value);
  if (!Number.isFinite(raw)) return 0;
  return clamp(raw, 0, 1);
}

export function shouldSuppressStaticReflections() {
  const t = el("scanClutterOn");
  return !t || !!t.checked;
}

export function getStaticSuppressionStrength() {
  const raw = parseFloat(el("scanClutterStrength").value);
  if (!Number.isFinite(raw)) return 0.65;
  return clamp(raw, 0, 1.2);
}

export function getQualityAlgo() {
  const mode = el("qualityAlgo")?.value || "balanced";
  if (mode === "auto" || mode === "fast" || mode === "balanced" || mode === "max") return mode;
  return "balanced";
}

export function getEffectiveQualityAlgo() {
  const selected = getQualityAlgo();
  if (selected !== "auto") return selected;

  const dwell = Math.max(30, parseFloat(el("scanDwell")?.value) || 140);
  const budgetMs = state.scanning ? clamp(dwell * 0.16, 8, 30) : 18;
  const p = state.qualityPerf.ewmaMs;
  let target = "max";
  if (p > budgetMs * 1.20) target = "fast";
  else if (p > budgetMs * 0.72) target = "balanced";

  const now = performance.now();
  if (target !== state.qualityPerf.lastResolved && (now - state.qualityPerf.lastSwitchAt) < 1200) {
    target = state.qualityPerf.lastResolved;
  }
  if (target !== state.qualityPerf.lastResolved) {
    state.qualityPerf.lastResolved = target;
    state.qualityPerf.lastSwitchAt = now;
    log(`[quality] auto -> ${target} (algo ${state.qualityPerf.ewmaMs.toFixed(1)}ms, budget ${budgetMs.toFixed(1)}ms)`);
  }
  return target;
}

export function qualityAlgoLabel() {
  const selected = getQualityAlgo();
  if (selected !== "auto") return selected;
  return `auto:${state.qualityPerf.lastResolved}`;
}

export function shouldUseEnvBaseline() {
  const t = el("useEnvBaseline");
  return !t || !!t.checked;
}

export function getEnvBaselineStrength() {
  const raw = parseFloat(el("envBaselineStrength").value);
  if (!Number.isFinite(raw)) return 0.55;
  return clamp(raw, 0, 1.2);
}

export function median3Profile(src) {
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

export function triSmoothProfile(src) {
  const n = src.length;
  const out = new Float32Array(n);
  if (!n) return out;
  out[0] = src[0];
  for (let i = 1; i < n - 1; i++) out[i] = 0.25 * src[i - 1] + 0.5 * src[i] + 0.25 * src[i + 1];
  if (n > 1) out[n - 1] = src[n - 1];
  return out;
}

export function adaptiveFloorSuppressProfile(src) {
  const n = src.length;
  const out = new Float32Array(n);
  const radius = 4;
  const floorScale = 0.9;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let cnt = 0;
    const lo = Math.max(0, i - radius);
    const hi = Math.min(n - 1, i + radius);
    for (let j = lo; j <= hi; j++) { sum += src[j]; cnt++; }
    const floor = (cnt > 0) ? (sum / cnt) : 0;
    const v = src[i] - floorScale * floor;
    out[i] = (v > 0) ? v : 0;
  }
  return out;
}

export function applyQualityProfileAlgorithms(profile) {
  const t0 = performance.now();
  const algo = getEffectiveQualityAlgo();
  if (algo === "fast") {
    const dt = performance.now() - t0;
    state.qualityPerf.ewmaMs = 0.82 * state.qualityPerf.ewmaMs + 0.18 * dt;
    return profile;
  }
  let out = median3Profile(profile);
  out = triSmoothProfile(out);
  if (algo === "max") {
    out = adaptiveFloorSuppressProfile(out);
    out = triSmoothProfile(out);
  }
  absMaxNormalize(out);
  const dt = performance.now() - t0;
  state.qualityPerf.ewmaMs = 0.82 * state.qualityPerf.ewmaMs + 0.18 * dt;
  return out;
}

export function applyEnvBaselineToProfile(profile) {
  if (!shouldUseEnvBaseline()) return;
  const base = state.calib.envBaseline;
  if (!base || base.length !== profile.length) return;
  const k = getEnvBaselineStrength();
  for (let i = 0; i < profile.length; i++) {
    const v = profile[i] - k * base[i];
    profile[i] = (v > 0) ? v : 0;
  }
}

export function suppressStaticReflectionsInProfile(profile) {
  if (!state.scanClutter || state.scanClutter.length !== profile.length) {
    state.scanClutter = new Float32Array(profile.length);
    state.scanClutter.fill(0);
  }
  const k = getStaticSuppressionStrength();
  const modelAlpha = 0.08;
  for (let i = 0; i < profile.length; i++) {
    const raw = profile[i];
    const bg = state.scanClutter[i];
    const cleaned = raw - k * bg;
    profile[i] = (cleaned > 0) ? cleaned : 0;
    state.scanClutter[i] = bg + modelAlpha * (raw - bg);
  }
}
