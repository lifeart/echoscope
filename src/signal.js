import { state } from './state.js';
import { clamp } from './utils.js';

function hann(n, N) {
  if (N <= 1) return 1;
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * n / (N - 1));
}

function fAttach(f) {
  return clamp(f, 800, 12000);
}

export function genChirp(f1, f2, Tms) {
  f1 = fAttach(f1); f2 = fAttach(f2);
  const T = Tms / 1000;
  const N = Math.max(1, Math.floor(state.sr * T));
  const out = new Float32Array(N);
  const k = (f2 - f1) / T;
  for (let n = 0; n < N; n++) {
    const t = n / state.sr;
    const phase = 2 * Math.PI * (f1 * t + 0.5 * k * t * t);
    out[n] = Math.sin(phase) * hann(n, N);
  }
  return out;
}

export function genGolayPair(orderN) {
  const n = orderN | 0;
  if (n < 1 || n > 14) throw new Error("Golay order must be 1..14 (length 2^n)");
  let A = new Int8Array([1]);
  let B = new Int8Array([1]);
  for (let k = 0; k < n; k++) {
    const A2 = new Int8Array(A.length + B.length);
    const B2 = new Int8Array(A.length + B.length);
    A2.set(A, 0);
    A2.set(B, A.length);
    B2.set(A, 0);
    for (let i = 0; i < B.length; i++) B2[A.length + i] = -B[i];
    A = A2; B = B2;
  }
  return { A, B };
}

export function chipBinarySequence(seq, chipRate, amplitude = 0.6) {
  const chipSamps = Math.max(1, Math.floor(state.sr / chipRate));
  const N = seq.length * chipSamps;
  const out = new Float32Array(N);
  let k = 0;
  for (let i = 0; i < seq.length; i++) {
    const v = seq[i] * amplitude;
    for (let j = 0; j < chipSamps; j++) out[k++] = v;
  }
  const fade = Math.min(192, out.length);
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    out[i] *= g;
    out[out.length - 1 - i] *= g;
  }
  return out;
}

export function genGolayChipped(orderN, chipRate) {
  const { A, B } = genGolayPair(orderN);
  const a = chipBinarySequence(A, chipRate, 0.55);
  const b = chipBinarySequence(B, chipRate, 0.55);
  return { a, b };
}

export function genMLS(order) {
  const m = order | 0;
  if (m < 2 || m > 16) throw new Error("MLS order must be 2..16");
  const tapsMap = {
    2: [2, 1], 3: [3, 2], 4: [4, 3], 5: [5, 3], 6: [6, 5], 7: [7, 6], 8: [8, 6, 5, 4],
    9: [9, 5], 10: [10, 7], 11: [11, 9], 12: [12, 6, 4, 1], 13: [13, 4, 3, 1],
    14: [14, 5, 3, 1], 15: [15, 14], 16: [16, 15, 13, 4]
  };
  const taps = tapsMap[m];
  const L = (1 << m) - 1;
  let reg = (1 << m) - 1;
  const seq = new Int8Array(L);
  for (let i = 0; i < L; i++) {
    const lsb = reg & 1;
    seq[i] = lsb ? 1 : -1;
    let fb = 0;
    for (let t = 0; t < taps.length; t++) {
      const bitIndex = taps[t] - 1;
      fb ^= (reg >> bitIndex) & 1;
    }
    reg = (reg >> 1) | (fb << (m - 1));
  }
  return seq;
}

export function genMLSChipped(order, chipRate) {
  return chipBinarySequence(genMLS(order), chipRate, 0.6);
}
