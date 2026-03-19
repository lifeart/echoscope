import { clamp } from '../utils.js';
import {
  blendTowardRaw,
  computeBackoffLevel,
  evaluateSubtractionGuard,
  type SubtractionBackoffOptions,
  type SubtractionGuardStats,
} from './clutter.js';

export interface NoiseKalmanState {
  x: Float32Array;
  p: Float32Array;
}

export interface NoiseKalmanUpdateOptions {
  q: number;
  r: number;
  gainClamp?: number;
  freeze?: boolean;
  minFloor?: number;
  maxFloor?: number;
}

export interface NoiseKalmanUpdateStats {
  updatedBins: number;
  meanGain: number;
  frozen: boolean;
}

export interface NoiseKalmanBackoffResult {
  profile: Float32Array;
  guard: SubtractionGuardStats | null;
  backoffLevel: number;
}

export function createNoiseKalmanState(
  bins: number,
  initialFloor = 0,
  initialVariance = 1,
): NoiseKalmanState {
  const size = Math.max(0, Math.floor(bins));
  const x = new Float32Array(size);
  const p = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    x[i] = initialFloor;
    p[i] = Math.max(1e-12, initialVariance);
  }
  return { x, p };
}

export function ensureNoiseKalmanState(
  state: NoiseKalmanState | null,
  bins: number,
  initialFloor = 0,
  initialVariance = 1,
): NoiseKalmanState {
  if (!state || state.x.length !== bins || state.p.length !== bins) {
    return createNoiseKalmanState(bins, initialFloor, initialVariance);
  }
  return state;
}

export function predictNoiseKalman(state: NoiseKalmanState, q: number): void {
  const qSafe = Math.max(0, q);
  for (let i = 0; i < state.p.length; i++) {
    state.p[i] += qSafe;
  }
}

export function updateNoiseKalman(
  state: NoiseKalmanState,
  measurement: Float32Array,
  options: NoiseKalmanUpdateOptions,
): NoiseKalmanUpdateStats {
  const len = Math.min(state.x.length, state.p.length, measurement.length);
  const qSafe = Math.max(0, options.q);
  const rSafe = Math.max(1e-12, options.r);
  const gainClamp = options.gainClamp == null ? 1 : clamp(options.gainClamp, 0, 1);
  const minFloor = options.minFloor ?? -Infinity;
  const maxFloor = options.maxFloor ?? Infinity;

  predictNoiseKalman(state, qSafe);

  if (options.freeze) {
    return { updatedBins: 0, meanGain: 0, frozen: true };
  }

  let gainSum = 0;
  for (let i = 0; i < len; i++) {
    const xPred = state.x[i];
    const pPred = state.p[i];
    const z = measurement[i];

    let gain = pPred / (pPred + rSafe);
    gain = clamp(gain, 0, gainClamp);

    const innovation = z - xPred;
    state.x[i] = clamp(xPred + gain * innovation, minFloor, maxFloor);
    state.p[i] = Math.max(1e-12, (1 - gain) * pPred);
    gainSum += gain;
  }

  return {
    updatedBins: len,
    meanGain: len > 0 ? gainSum / len : 0,
    frozen: false,
  };
}

export function subtractNoiseFloor(
  profile: Float32Array,
  state: NoiseKalmanState,
  strength: number,
  minFloor = -Infinity,
  maxFloor = Infinity,
): Float32Array {
  const len = Math.min(profile.length, state.x.length);
  const out = new Float32Array(profile.length);
  const k = Math.max(0, strength);
  for (let i = 0; i < len; i++) {
    const floor = clamp(state.x[i], minFloor, maxFloor);
    const v = profile[i] - k * floor;
    out[i] = v > 0 ? v : 0;
  }
  for (let i = len; i < profile.length; i++) out[i] = profile[i];
  return out;
}

export function guardBackoff(
  raw: Float32Array,
  cleaned: Float32Array,
  backoff?: SubtractionBackoffOptions,
): NoiseKalmanBackoffResult {
  if (!backoff?.enabled) {
    return { profile: cleaned, guard: null, backoffLevel: 0 };
  }

  const guard = evaluateSubtractionGuard(raw, cleaned, backoff);
  if (!guard.shouldBackoff) {
    return { profile: cleaned, guard, backoffLevel: 0 };
  }

  const backoffLevel = computeBackoffLevel(guard, backoff);

  return {
    profile: blendTowardRaw(raw, cleaned, backoffLevel),
    guard,
    backoffLevel,
  };
}
