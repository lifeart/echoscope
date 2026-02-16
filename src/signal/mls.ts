import { FADE_SAMPLES } from '../constants.js';
import type { MLSConfig } from '../types.js';

/**
 * Primitive polynomial feedback taps for Fibonacci LFSR MLS generation.
 * Each entry lists the exponents of the primitive polynomial x^m + ... + 1.
 * The leading x^m and constant 1 terms are implicit in the generator:
 * the leading term drives the shift and the constant term is seeded
 * via `fb = reg & 1` before XOR-ing with the listed tap positions.
 *
 * Verified against Table 6.1 in Golomb, "Shift Register Sequences" (1967)
 * and ITU-T O.150 Annex A.
 */
const TAPS_MAP: Record<number, number[]> = {
  2: [2, 1],             // x^2 + x + 1
  3: [3, 1],             // x^3 + x + 1
  4: [4, 1],             // x^4 + x + 1
  5: [5, 2],             // x^5 + x^2 + 1
  6: [6, 1],             // x^6 + x + 1
  7: [7, 1],             // x^7 + x + 1
  8: [8, 6, 5, 4],      // x^8 + x^6 + x^5 + x^4 + 1
  9: [9, 4],             // x^9 + x^4 + 1
  10: [10, 3],           // x^10 + x^3 + 1
  11: [11, 2],           // x^11 + x^2 + 1
  12: [12, 6, 4, 1],    // x^12 + x^6 + x^4 + x + 1
  13: [13, 4, 3, 1],    // x^13 + x^4 + x^3 + x + 1
  14: [14, 5, 3, 1],    // x^14 + x^5 + x^3 + x + 1
  15: [15, 1],           // x^15 + x + 1
  16: [16, 5, 3, 2],    // x^16 + x^5 + x^3 + x^2 + 1
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
    // Fibonacci LFSR feedback: XOR the register bit at each tap position.
    // The constant term (+1) is included implicitly via initializing fb
    // from the LSB (output bit = reg & 1).  The leading x^m term is
    // skipped because it represents the shift operation itself.
    let fb = reg & 1;
    for (let t = 0; t < taps.length; t++) {
      if (taps[t] === m) continue; // skip leading term x^m
      fb ^= (reg >> taps[t]) & 1;
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
  const fade = Math.min(FADE_SAMPLES, Math.floor(out.length / 2));
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
