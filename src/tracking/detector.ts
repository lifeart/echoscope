import type { Measurement } from '../types.js';

/**
 * CFAR-like peak detector: extracts measurements from a range profile.
 * Finds all peaks above an adaptive threshold.
 */
export function detectPeaks(
  profile: Float32Array,
  minR: number,
  maxR: number,
  angleDeg: number,
  timestamp: number,
  options: {
    guardCells?: number;
    trainingCells?: number;
    thresholdFactor?: number;
    minStrength?: number;
  } = {},
): Measurement[] {
  const {
    guardCells = 2,
    trainingCells = 8,
    thresholdFactor = 3.0,
    minStrength = 0.05,
  } = options;

  const n = profile.length;
  if (n < 2) return [];

  const measurements: Measurement[] = [];

  for (let i = 1; i < n - 1; i++) {
    // Check if local maximum
    if (profile[i] <= profile[i - 1] || profile[i] <= profile[i + 1]) continue;
    if (profile[i] < minStrength) continue;

    // CFAR-like threshold: average of training cells around guard region
    let sum = 0;
    let count = 0;
    for (let j = i - guardCells - trainingCells; j <= i + guardCells + trainingCells; j++) {
      if (j < 0 || j >= n) continue;
      if (Math.abs(j - i) <= guardCells) continue; // skip guard cells
      sum += profile[j];
      count++;
    }

    const threshold = count > 0 ? (sum / count) * thresholdFactor : minStrength;
    if (profile[i] < threshold) continue;

    // Convert bin to range
    const range = minR + (i / (n - 1)) * (maxR - minR);

    measurements.push({
      range,
      angleDeg,
      strength: profile[i],
      timestamp,
    });
  }

  return measurements;
}
