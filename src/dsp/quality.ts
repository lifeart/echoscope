export function median3Profile(src: Float32Array): Float32Array {
  const n = src.length;
  const out = new Float32Array(n);
  if (!n) return out;
  out[0] = src[0];
  for (let i = 1; i < n - 1; i++) {
    const a = src[i - 1], b = src[i], c = src[i + 1];
    out[i] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  }
  if (n > 1) out[n - 1] = src[n - 1];
  return out;
}

export function triSmoothProfile(src: Float32Array): Float32Array {
  const n = src.length;
  const out = new Float32Array(n);
  if (!n) return out;
  out[0] = src[0];
  for (let i = 1; i < n - 1; i++) out[i] = 0.25 * src[i - 1] + 0.5 * src[i] + 0.25 * src[i + 1];
  if (n > 1) out[n - 1] = src[n - 1];
  return out;
}

export function adaptiveFloorSuppressProfile(src: Float32Array): Float32Array {
  const n = src.length;
  const out = new Float32Array(n);
  const radius = 4;
  const floorScale = 0.9;
  for (let i = 0; i < n; i++) {
    let sum = 0, cnt = 0;
    const lo = Math.max(0, i - radius);
    const hi = Math.min(n - 1, i + radius);
    for (let j = lo; j <= hi; j++) { sum += src[j]; cnt++; }
    const floor = cnt > 0 ? sum / cnt : 0;
    const v = src[i] - floorScale * floor;
    out[i] = v > 0 ? v : 0;
  }
  return out;
}

export type QualityAlgoName = 'fast' | 'balanced' | 'max';

export function applyQualityAlgorithms(profile: Float32Array, algo: QualityAlgoName): Float32Array {
  if (algo === 'fast') return new Float32Array(profile);
  let out = median3Profile(profile);
  out = triSmoothProfile(out);
  if (algo === 'max') {
    out = adaptiveFloorSuppressProfile(out);
    out = triSmoothProfile(out);
  }
  return out;
}
