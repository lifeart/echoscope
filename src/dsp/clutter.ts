export interface ClutterState {
  model: Float32Array | null;
}

export function createClutterState(): ClutterState {
  return { model: null };
}

export function suppressStaticReflections(
  profile: Float32Array,
  clutterState: ClutterState,
  strength: number,
  modelAlpha = 0.08,
): { profile: Float32Array; clutterState: ClutterState } {
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
    newModel[i] = bg + modelAlpha * (raw - bg);
  }
  return { profile: out, clutterState: { model: newModel } };
}

export function applyEnvBaseline(
  profile: Float32Array,
  baseline: Float32Array | null,
  strength: number,
): Float32Array {
  if (!baseline || baseline.length !== profile.length) return profile;
  const out = new Float32Array(profile.length);
  for (let i = 0; i < profile.length; i++) {
    const v = profile[i] - strength * baseline[i];
    out[i] = v > 0 ? v : 0;
  }
  return out;
}
