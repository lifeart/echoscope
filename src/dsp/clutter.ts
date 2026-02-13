export interface ClutterState {
  model: Float32Array | null;
}

export interface SubtractionBackoffOptions {
  enabled: boolean;
  collapseThreshold: number;
  peakDropThreshold: number;
}

export interface SubtractionGuardStats {
  collapseRatio: number;
  peakRetention: number;
  shouldBackoff: boolean;
}

export interface ClutterSuppressOptions {
  modelAlpha?: number;
  backoff?: SubtractionBackoffOptions;
  selectiveUpdate?: {
    enabled: boolean;
    noveltyRatio: number;
  };
}

export function createClutterState(): ClutterState {
  return { model: null };
}

function profileEnergyAndPeak(profile: Float32Array): { energy: number; peak: number } {
  let energy = 0;
  let peak = 0;
  for (let i = 0; i < profile.length; i++) {
    const v = profile[i];
    energy += v * v;
    if (v > peak) peak = v;
  }
  return { energy, peak };
}

export function evaluateSubtractionGuard(
  before: Float32Array,
  after: Float32Array,
  options: SubtractionBackoffOptions,
): SubtractionGuardStats {
  const b = profileEnergyAndPeak(before);
  const a = profileEnergyAndPeak(after);
  const collapseRatio = a.energy / Math.max(1e-12, b.energy);
  const peakRetention = a.peak / Math.max(1e-12, b.peak);
  const shouldBackoff = options.enabled
    && (collapseRatio < options.collapseThreshold || peakRetention < options.peakDropThreshold);
  return { collapseRatio, peakRetention, shouldBackoff };
}

function blendTowardRaw(raw: Float32Array, cleaned: Float32Array, backoffLevel: number): Float32Array {
  const out = new Float32Array(raw.length);
  const k = Math.max(0, Math.min(1, backoffLevel));
  for (let i = 0; i < raw.length; i++) {
    out[i] = cleaned[i] * (1 - k) + raw[i] * k;
  }
  return out;
}

export function suppressStaticReflections(
  profile: Float32Array,
  clutterState: ClutterState,
  strength: number,
  modelAlphaOrOptions: number | ClutterSuppressOptions = 0.08,
): { profile: Float32Array; clutterState: ClutterState } {
  const options: ClutterSuppressOptions = typeof modelAlphaOrOptions === 'number'
    ? { modelAlpha: modelAlphaOrOptions, selectiveUpdate: { enabled: false, noveltyRatio: 0.35 } }
    : modelAlphaOrOptions;
  const modelAlpha = options.modelAlpha ?? 0.08;
  const selectiveUpdate = options.selectiveUpdate ?? { enabled: false, noveltyRatio: 0.35 };

  if (!clutterState.model || clutterState.model.length !== profile.length) {
    clutterState = { model: new Float32Array(profile.length) };
  }

  const out = new Float32Array(profile.length);
  const newModel = new Float32Array(profile.length);
  for (let i = 0; i < profile.length; i++) {
    const raw = profile[i];
    const bg = clutterState.model![i];
    const cleaned = raw - strength * bg;
    out[i] = cleaned > 0 ? cleaned : 0;

    const noveltyLikely = selectiveUpdate.enabled && out[i] > raw * selectiveUpdate.noveltyRatio;
    const alpha = noveltyLikely ? modelAlpha * 0.15 : modelAlpha;
    newModel[i] = bg + alpha * (raw - bg);
  }

  if (options.backoff?.enabled) {
    const guard = evaluateSubtractionGuard(profile, out, options.backoff);
    if (guard.shouldBackoff) {
      const collapseDeficit = Math.max(0, (options.backoff.collapseThreshold - guard.collapseRatio) / Math.max(1e-6, options.backoff.collapseThreshold));
      const peakDeficit = Math.max(0, (options.backoff.peakDropThreshold - guard.peakRetention) / Math.max(1e-6, options.backoff.peakDropThreshold));
      const backoffLevel = Math.max(collapseDeficit, peakDeficit);
      return {
        profile: blendTowardRaw(profile, out, backoffLevel),
        clutterState: { model: clutterState.model },
      };
    }
  }

  return { profile: out, clutterState: { model: newModel } };
}

export function applyEnvBaseline(
  profile: Float32Array,
  baseline: Float32Array | null,
  strength: number,
  backoff?: SubtractionBackoffOptions,
): Float32Array {
  if (!baseline || baseline.length !== profile.length) return profile;

  const out = new Float32Array(profile.length);
  for (let i = 0; i < profile.length; i++) {
    const v = profile[i] - strength * baseline[i];
    out[i] = v > 0 ? v : 0;
  }

  if (!backoff?.enabled) return out;
  const guard = evaluateSubtractionGuard(profile, out, backoff);
  if (!guard.shouldBackoff) return out;

  const collapseDeficit = Math.max(0, (backoff.collapseThreshold - guard.collapseRatio) / Math.max(1e-6, backoff.collapseThreshold));
  const peakDeficit = Math.max(0, (backoff.peakDropThreshold - guard.peakRetention) / Math.max(1e-6, backoff.peakDropThreshold));
  const backoffLevel = Math.max(collapseDeficit, peakDeficit);
  return blendTowardRaw(profile, out, backoffLevel);
}
