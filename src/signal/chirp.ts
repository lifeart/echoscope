import { clamp } from '../utils.js';
import { MIN_FREQUENCY, MAX_FREQUENCY } from '../constants.js';
import { hann } from './window.js';
import type { ChirpConfig } from '../types.js';

export function genChirp(config: ChirpConfig, sampleRate: number): Float32Array {
  const f1 = clamp(config.f1, MIN_FREQUENCY, MAX_FREQUENCY);
  const f2 = clamp(config.f2, MIN_FREQUENCY, MAX_FREQUENCY);
  const T = config.durationMs / 1000;
  const N = Math.max(1, Math.floor(sampleRate * T));
  const out = new Float32Array(N);
  const k = (f2 - f1) / T;
  for (let n = 0; n < N; n++) {
    const t = n / sampleRate;
    const phase = 2 * Math.PI * (f1 * t + 0.5 * k * t * t);
    out[n] = Math.sin(phase) * hann(n, N);
  }
  return out;
}
