export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Sum of squared samples. */
export function signalEnergy(a: Float32Array): number {
  let e = 0;
  for (let i = 0; i < a.length; i++) e += a[i] * a[i];
  return e;
}

/** In-place divide every sample by refEnergy (acts as energy normalization). */
export function energyNormalize(corr: Float32Array, refEnergy: number): void {
  if (refEnergy <= 1e-12) return;
  const inv = 1 / refEnergy;
  for (let i = 0; i < corr.length; i++) corr[i] *= inv;
}

export function median(arr: number[]): number {
  const a = arr.filter(v => isFinite(v));
  const n = a.length;
  if (!n) return 0;
  a.sort((x, y) => x - y);
  if (n % 2) return a[(n / 2) | 0];
  return 0.5 * (a[n / 2 - 1] + a[n / 2]);
}

export function mad(arr: number[], med: number): number {
  const d = arr.filter(v => isFinite(v)).map(x => Math.abs(x - med));
  return median(d);
}
