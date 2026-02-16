import { clamp, median } from '../utils.js';

export interface ProfileConfidenceMetrics {
  psr: number;
  sharpness: number;
  sidelobeRatio: number;
  confidence: number;
}

export function computeProfileConfidence(
  profile: Float32Array,
  bestBin: number,
  bestVal: number,
): ProfileConfidenceMetrics {
  if (profile.length === 0 || bestBin < 0 || bestBin >= profile.length || bestVal <= 0) {
    return { psr: 0, sharpness: 0, sidelobeRatio: 0, confidence: 0 };
  }

  const floorSamples: number[] = [];
  for (let i = 0; i < profile.length; i++) {
    if (Math.abs(i - bestBin) <= 2) continue;
    floorSamples.push(profile[i]);
  }
  const floor = Math.max(1e-12, median(floorSamples));
  const psr = bestVal / floor;

  const left = bestBin > 0 ? profile[bestBin - 1] : bestVal;
  const right = bestBin + 1 < profile.length ? profile[bestBin + 1] : bestVal;
  const curvature = Math.max(0, bestVal - 0.5 * (left + right));
  const sharpness = curvature / Math.max(1e-12, bestVal);

  let mainEnergy = 0;
  let sideEnergy = 0;
  for (let i = 0; i < profile.length; i++) {
    const e = profile[i] * profile[i];
    if (Math.abs(i - bestBin) <= 1) mainEnergy += e;
    else sideEnergy += e;
  }
  const sidelobeRatio = mainEnergy / Math.max(1e-12, sideEnergy);

  // Use log-scale mapping for sidelobe ratio to maintain sensitivity
  // across the full dynamic range.  Linear mapping saturates at ~3.4;
  // log10 maps [1..1000] → [0..3] → clamp to [0..1].
  const normPsr = clamp((psr - 1.5) / 8, 0, 1);
  const normSharp = clamp(sharpness * 2.5, 0, 1);
  const normSide = clamp(Math.log10(Math.max(1, sidelobeRatio)) / 3, 0, 1);
  const confidence = clamp(0.45 * normPsr + 0.25 * normSharp + 0.30 * normSide, 0, 1);

  return { psr, sharpness, sidelobeRatio, confidence };
}

export function smooth3(values: Float32Array): Float32Array {
  if (values.length <= 2) return Float32Array.from(values);
  const out = new Float32Array(values.length);
  out[0] = 0.75 * values[0] + 0.25 * values[1];
  for (let i = 1; i < values.length - 1; i++) {
    out[i] = 0.25 * values[i - 1] + 0.5 * values[i] + 0.25 * values[i + 1];
  }
  const n = values.length - 1;
  out[n] = 0.25 * values[n - 1] + 0.75 * values[n];
  return out;
}
