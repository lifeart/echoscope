export function hann(n: number, N: number): number {
  if (N <= 1) return 1;
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * n / (N - 1));
}

export function blackmanHarris(n: number, N: number): number {
  if (N <= 1) return 1;
  const a0 = 0.35875, a1 = 0.48829, a2 = 0.14128, a3 = 0.01168;
  const x = 2 * Math.PI * n / (N - 1);
  return a0 - a1 * Math.cos(x) + a2 * Math.cos(2 * x) - a3 * Math.cos(3 * x);
}

export function applyWindow(signal: Float32Array, windowFn: (n: number, N: number) => number): Float32Array {
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = signal[i] * windowFn(i, signal.length);
  return out;
}
