export function correlate(x: Float32Array, s: Float32Array): Float32Array {
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
