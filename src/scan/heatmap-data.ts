import type { HeatmapData } from '../types.js';
import { pickBestFromProfile } from '../dsp/peak.js';

export interface HeatmapRowUpdateOptions {
  decayFactor?: number;
  temporalIirAlpha?: number;
}

export interface ProfileAggregateOptions {
  mode?: 'mean' | 'median' | 'trimmedMean';
  trimFraction?: number;
}

export function createHeatmap(angles: number[], bins: number): HeatmapData {
  const count = angles.length;
  return {
    angles: angles.slice(),
    bins,
    data: new Float32Array(count * bins),
    display: new Float32Array(count * bins),
    bestBin: new Int16Array(count).fill(-1),
    bestVal: new Float32Array(count),
  };
}

export function updateHeatmapRow(
  heatmap: HeatmapData,
  rowIndex: number,
  profile: Float32Array,
  bestBin: number,
  bestVal: number,
  decayOrOptions: number | HeatmapRowUpdateOptions = 0.90,
): void {
  const { bins, data, bestBin: bestBinArr, bestVal: bestValArr } = heatmap;
  const options: HeatmapRowUpdateOptions = typeof decayOrOptions === 'number'
    ? { decayFactor: decayOrOptions }
    : decayOrOptions;
  const decayFactor = options.decayFactor ?? 0.90;
  const temporalIirAlpha = options.temporalIirAlpha;

  // Debug: log profile stats
  let pMin = Infinity, pMax = -Infinity, pNonZero = 0;
  for (let b = 0; b < profile.length; b++) {
    if (profile[b] < pMin) pMin = profile[b];
    if (profile[b] > pMax) pMax = profile[b];
    if (profile[b] > 1e-15) pNonZero++;
  }
  console.log(`[updateHeatmapRow] row=${rowIndex} profileLen=${profile.length} heatmapBins=${bins} profileMin=${pMin.toExponential(3)} profileMax=${pMax.toExponential(3)} nonZero=${pNonZero}/${profile.length} bestBin=${bestBin} bestVal=${bestVal.toExponential(3)}`);

  // Check if the incoming profile is entirely zero (weak/rejected ping).
  // In that case, apply pure decay instead of max-accumulating noise residue.
  let profileIsZero = true;
  for (let b = 0; b < Math.min(bins, profile.length); b++) {
    if (profile[b] > 1e-15) { profileIsZero = false; break; }
  }

  for (let b = 0; b < bins; b++) {
    const idx = rowIndex * bins + b;
    if (profileIsZero) {
      // Zeroed profile = no detection. Decay existing data toward zero.
      data[idx] *= decayFactor;
      // Snap to zero once negligible to avoid infinite decay tail.
      // Threshold 1e-10 ensures zero is reached in ~170 iterations of 0.90 decay
      // (well below the display hasData threshold of 1e-7).
      if (data[idx] < 1e-10) data[idx] = 0;
    } else if (Number.isFinite(temporalIirAlpha)) {
      const decayed = data[idx] * decayFactor;
      const alpha = Math.max(0.01, Math.min(1, temporalIirAlpha!));
      data[idx] = decayed + alpha * (profile[b] - decayed);
    } else {
      const decayed = data[idx] * decayFactor;
      data[idx] = Math.max(decayed, profile[b]);
    }
  }
  if (Number.isFinite(temporalIirAlpha)) {
    const integrated = data.subarray(rowIndex * bins, rowIndex * bins + bins);
    const bestIntegrated = pickBestFromProfile(integrated);
    bestBinArr[rowIndex] = bestIntegrated.bin;
    bestValArr[rowIndex] = bestIntegrated.val;
  } else {
    bestBinArr[rowIndex] = bestBin;
    bestValArr[rowIndex] = bestVal;
  }

  // Debug: verify data was written
  let dMax = 0, dNonZero = 0;
  for (let b = 0; b < bins; b++) {
    const v = data[rowIndex * bins + b];
    if (v > dMax) dMax = v;
    if (v > 1e-15) dNonZero++;
  }
  console.log(`[updateHeatmapRow] after: dataMax=${dMax.toExponential(3)} dataNonZero=${dNonZero}/${bins}`);
}

export function averageProfiles(
  profiles: Float32Array[],
): { averaged: Float32Array; bestBin: number; bestVal: number } {
  return aggregateProfiles(profiles, { mode: 'mean' });
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  if (values.length % 2 === 0) return 0.5 * (values[mid - 1] + values[mid]);
  return values[mid];
}

export function aggregateProfiles(
  profiles: Float32Array[],
  options?: ProfileAggregateOptions,
): { averaged: Float32Array; bestBin: number; bestVal: number } {
  const mode = options?.mode ?? 'mean';
  const trimFraction = Math.max(0, Math.min(0.45, options?.trimFraction ?? 0.2));

  if (profiles.length === 0) {
    const empty = new Float32Array(0);
    return { averaged: empty, bestBin: -1, bestVal: 0 };
  }
  if (profiles.length === 1) {
    const best = pickBestFromProfile(profiles[0]);
    return { averaged: profiles[0], bestBin: best.bin, bestVal: best.val };
  }
  const len = profiles[0].length;
  const averaged = new Float32Array(len);
  const n = profiles.length;

  if (mode === 'mean') {
    for (let i = 0; i < len; i++) {
      let sum = 0;
      for (let p = 0; p < n; p++) sum += profiles[p][i];
      averaged[i] = sum / n;
    }
  } else {
    const values: number[] = new Array(n);
    for (let i = 0; i < len; i++) {
      for (let p = 0; p < n; p++) values[p] = profiles[p][i];
      if (mode === 'median') {
        averaged[i] = median(values);
      } else {
        values.sort((a, b) => a - b);
        const trim = Math.min(Math.floor(n * trimFraction), Math.floor((n - 1) / 2));
        const lo = trim;
        const hi = n - trim;
        let sum = 0;
        for (let j = lo; j < hi; j++) sum += values[j];
        averaged[i] = sum / Math.max(1, hi - lo);
      }
    }
  }

  const best = pickBestFromProfile(averaged);
  return { averaged, bestBin: best.bin, bestVal: best.val };
}

export function crossAngleSmooth(heatmap: HeatmapData, radius = 1): void {
  const rows = heatmap.angles.length;
  const bins = heatmap.bins;
  if (rows < 3) return; // Not enough rows to smooth

  const temp = new Float32Array(rows);
  for (let b = 0; b < bins; b++) {
    // Collect column values
    for (let r = 0; r < rows; r++) {
      temp[r] = heatmap.data[r * bins + b];
    }
    // Apply median filter per column
    for (let r = 0; r < rows; r++) {
      const lo = Math.max(0, r - radius);
      const hi = Math.min(rows - 1, r + radius);
      const window: number[] = [];
      for (let nr = lo; nr <= hi; nr++) {
        window.push(temp[nr]);
      }
      window.sort((a, b2) => a - b2);
      const mid = Math.floor(window.length / 2);
      heatmap.data[r * bins + b] = window.length % 2 === 0
        ? 0.5 * (window[mid - 1] + window[mid])
        : window[mid];
    }
  }

  // Update bestBin/bestVal per row
  for (let r = 0; r < rows; r++) {
    const rowData = heatmap.data.subarray(r * bins, r * bins + bins);
    const best = pickBestFromProfile(rowData);
    heatmap.bestBin[r] = best.bin;
    heatmap.bestVal[r] = best.val;
  }

  // Reset display to force re-smoothing
  heatmap.display.fill(0);
}

export function smoothHeatmapDisplay(heatmap: HeatmapData, alpha = 0.22): void {
  const { data, display } = heatmap;
  let dMax = 0, dispMaxBefore = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] > dMax) dMax = data[i];
    if (display[i] > dispMaxBefore) dispMaxBefore = display[i];
  }
  for (let i = 0; i < data.length; i++) {
    display[i] += alpha * (data[i] - display[i]);
  }
  let dispMaxAfter = 0;
  for (let i = 0; i < display.length; i++) {
    if (display[i] > dispMaxAfter) dispMaxAfter = display[i];
  }
  console.log(`[smoothHeatmapDisplay] alpha=${alpha} dataMax=${dMax.toExponential(3)} displayMaxBefore=${dispMaxBefore.toExponential(3)} displayMaxAfter=${dispMaxAfter.toExponential(3)}`);
}
