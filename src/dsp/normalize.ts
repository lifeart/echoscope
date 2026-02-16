/**
 * Normalize by absolute maximum.  **Mutates the input array in-place**
 * and returns a reference to it. Clone first if the original is needed.
 */
export function absMaxNormalize(a: Float32Array): Float32Array {
  let mx = 0;
  for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > mx) mx = v; }
  if (mx <= 1e-12) return a;
  const inv = 1 / mx;
  for (let i = 0; i < a.length; i++) a[i] *= inv;
  return a;
}

/**
 * Normalize by positive peak.  **Mutates the input array in-place**
 * and returns a reference to it. Clone first if the original is needed.
 */
export function peakNormalize(a: Float32Array): Float32Array {
  let mx = -Infinity;
  for (let i = 0; i < a.length; i++) if (a[i] > mx) mx = a[i];
  if (mx <= 1e-12) return a;
  const inv = 1 / mx;
  for (let i = 0; i < a.length; i++) a[i] *= inv;
  return a;
}

export function toDecibels(value: number, reference = 1.0): number {
  if (value <= 0) return -Infinity;
  return 20 * Math.log10(value / reference);
}

export function linearToDbNormalized(amplitude: number, noiseFloor: number, dynamicRangeDb = 40): number {
  if (amplitude <= 0 || noiseFloor <= 0) return 0;
  const db = 20 * Math.log10(amplitude / noiseFloor);
  return db <= 0 ? 0 : Math.min(1, db / dynamicRangeDb);
}
