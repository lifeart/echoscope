import { FADE_SAMPLES } from '../constants.js';
import type { MLSConfig } from '../types.js';

const TAPS_MAP: Record<number, number[]> = {
  2: [2, 1], 3: [3, 2], 4: [4, 3], 5: [5, 3], 6: [6, 5], 7: [7, 6], 8: [8, 6, 5, 4],
  9: [9, 5], 10: [10, 7], 11: [11, 9], 12: [12, 6, 4, 1], 13: [13, 4, 3, 1],
  14: [14, 5, 3, 1], 15: [15, 14], 16: [16, 15, 13, 4],
};

export function genMLS(order: number): Int8Array {
  const m = order | 0;
  if (m < 2 || m > 16) throw new Error('MLS order must be 2..16');
  const taps = TAPS_MAP[m];
  const L = (1 << m) - 1;
  let reg = (1 << m) - 1;
  const seq = new Int8Array(L);
  for (let i = 0; i < L; i++) {
    const lsb = reg & 1;
    seq[i] = lsb ? 1 : -1;
    let fb = 0;
    for (let t = 0; t < taps.length; t++) {
      fb ^= (reg >> (taps[t] - 1)) & 1;
    }
    reg = (reg >> 1) | (fb << (m - 1));
  }
  return seq;
}

export function chipBinarySequence(seq: Int8Array, chipRate: number, sampleRate: number, amplitude = 0.6): Float32Array {
  const chipSamps = Math.max(1, Math.floor(sampleRate / chipRate));
  const N = seq.length * chipSamps;
  const out = new Float32Array(N);
  let k = 0;
  for (let i = 0; i < seq.length; i++) {
    const v = seq[i] * amplitude;
    for (let j = 0; j < chipSamps; j++) out[k++] = v;
  }
  const fade = Math.min(FADE_SAMPLES, out.length);
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    out[i] *= g;
    out[out.length - 1 - i] *= g;
  }
  return out;
}

export function genMLSChipped(config: MLSConfig, sampleRate: number): Float32Array {
  return chipBinarySequence(genMLS(config.order), config.chipRate, sampleRate, 0.6);
}
