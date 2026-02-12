import type { HeatmapData } from '../types.js';

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
  decayFactor = 0.90,
): void {
  const { bins, data, bestBin: bestBinArr, bestVal: bestValArr } = heatmap;
  for (let b = 0; b < bins; b++) {
    const idx = rowIndex * bins + b;
    data[idx] = Math.max(data[idx] * decayFactor, profile[b]);
  }
  bestBinArr[rowIndex] = bestBin;
  bestValArr[rowIndex] = bestVal;
}

export function smoothHeatmapDisplay(heatmap: HeatmapData, alpha = 0.22): void {
  const { data, display } = heatmap;
  for (let i = 0; i < data.length; i++) {
    display[i] += alpha * (data[i] - display[i]);
  }
}
