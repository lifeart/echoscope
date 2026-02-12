import { chipBinarySequence } from './mls.js';
import type { GolayConfig } from '../types.js';

export function genGolayPair(orderN: number): { A: Int8Array; B: Int8Array } {
  const n = orderN | 0;
  if (n < 1 || n > 14) throw new Error('Golay order must be 1..14 (length 2^n)');
  let A = new Int8Array([1]);
  let B = new Int8Array([1]);
  for (let k = 0; k < n; k++) {
    const A2 = new Int8Array(A.length + B.length);
    const B2 = new Int8Array(A.length + B.length);
    A2.set(A, 0);
    A2.set(B, A.length);
    B2.set(A, 0);
    for (let i = 0; i < B.length; i++) B2[A.length + i] = -B[i] as -1 | 1;
    A = A2; B = B2;
  }
  return { A, B };
}

export function genGolayChipped(config: GolayConfig, sampleRate: number): { a: Float32Array; b: Float32Array } {
  const { A, B } = genGolayPair(config.order);
  const a = chipBinarySequence(A, config.chipRate, sampleRate, 0.55);
  const b = chipBinarySequence(B, config.chipRate, sampleRate, 0.55);
  return { a, b };
}
