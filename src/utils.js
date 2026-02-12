export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export function median(arr) {
  const a = arr.slice().sort((x, y) => x - y);
  const n = a.length;
  if (!n) return NaN;
  if (n % 2) return a[(n / 2) | 0];
  return 0.5 * (a[n / 2 - 1] + a[n / 2]);
}

export function mad(arr, med) {
  const d = arr.map(x => Math.abs(x - med));
  return median(d);
}
