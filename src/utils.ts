export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export function median(arr: number[]): number {
  const a = arr.slice().sort((x, y) => x - y);
  const n = a.length;
  if (!n) return NaN;
  if (n % 2) return a[(n / 2) | 0];
  return 0.5 * (a[n / 2 - 1] + a[n / 2]);
}

export function mad(arr: number[], med: number): number {
  const d = arr.map(x => Math.abs(x - med));
  return median(d);
}
