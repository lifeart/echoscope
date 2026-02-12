import type { ArrayGeometry, DOAEstimate } from '../types.js';
import { gccPhat } from '../dsp/gcc-phat.js';

/**
 * SRP-PHAT Direction-of-Arrival estimation.
 * Sweeps candidate angles, computes steered response power using GCC-PHAT
 * across all mic pairs, returns angle with maximum power.
 */
export function srpPhatDOA(
  channels: Float32Array[],
  geometry: ArrayGeometry,
  sampleRate: number,
  angleRange: { minDeg: number; maxDeg: number; stepDeg: number } = { minDeg: -60, maxDeg: 60, stepDeg: 1 },
): DOAEstimate {
  const nChannels = channels.length;

  if (nChannels < 2) {
    return { azimuthDeg: 0, elevationDeg: 0, confidence: 0, method: 'srp-phat' };
  }

  const mics = geometry.microphones;
  const c = geometry.speedOfSound;

  // Build mic pairs
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < nChannels; i++) {
    for (let j = i + 1; j < nChannels; j++) {
      pairs.push([i, j]);
    }
  }

  // Pre-compute GCC-PHAT for each pair
  const gccResults = pairs.map(([i, j]) => gccPhat(channels[i], channels[j], sampleRate));

  // Sweep angles
  let bestAngle = 0;
  let bestPower = -Infinity;

  for (let angle = angleRange.minDeg; angle <= angleRange.maxDeg; angle += angleRange.stepDeg) {
    const theta = angle * Math.PI / 180;
    let totalPower = 0;

    for (let p = 0; p < pairs.length; p++) {
      const [i, j] = pairs[p];
      const dx = mics[j].x - mics[i].x;
      // Expected TDOA for this angle
      const expectedDelay = (dx * Math.sin(theta)) / c;
      // Look up GCC value at expected delay
      const delaySamples = Math.round(expectedDelay * sampleRate);
      const gcc = gccResults[p].gcc;
      const N = gcc.length;
      // Handle wrap-around in GCC output
      let idx = delaySamples;
      if (idx < 0) idx += N;
      if (idx >= 0 && idx < N) {
        totalPower += gcc[idx];
      }
    }

    if (totalPower > bestPower) {
      bestPower = totalPower;
      bestAngle = angle;
    }
  }

  // Confidence: normalize power
  const maxPossible = pairs.length;
  const confidence = maxPossible > 0 ? Math.min(1, Math.max(0, bestPower / maxPossible)) : 0;

  return {
    azimuthDeg: bestAngle,
    elevationDeg: 0,
    confidence,
    method: 'srp-phat',
  };
}

/**
 * Simple scan-peak DOA: find the angle with maximum correlation peak.
 * Works with single mic by varying TX steering angle.
 */
export function scanPeakDOA(
  peakStrengths: Map<number, number>,
): DOAEstimate {
  let bestAngle = 0;
  let bestStrength = -Infinity;

  for (const [angle, strength] of peakStrengths) {
    if (strength > bestStrength) {
      bestStrength = strength;
      bestAngle = angle;
    }
  }

  return {
    azimuthDeg: bestAngle,
    elevationDeg: 0,
    confidence: Math.min(1, Math.max(0, bestStrength)),
    method: 'scan-peak',
  };
}
