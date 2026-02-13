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

  // Debug: log profile stats
  let pMin = Infinity, pMax = -Infinity, pNonZero = 0;
  for (let b = 0; b < profile.length; b++) {
    if (profile[b] < pMin) pMin = profile[b];
    if (profile[b] > pMax) pMax = profile[b];
    if (profile[b] > 1e-15) pNonZero++;
  }
  console.log(`[updateHeatmapRow] row=${rowIndex} profileLen=${profile.length} heatmapBins=${bins} profileMin=${pMin.toExponential(3)} profileMax=${pMax.toExponential(3)} nonZero=${pNonZero}/${profile.length} bestBin=${bestBin} bestVal=${bestVal.toExponential(3)}`);

  for (let b = 0; b < bins; b++) {
    const idx = rowIndex * bins + b;
    data[idx] = Math.max(data[idx] * decayFactor, profile[b]);
  }
  bestBinArr[rowIndex] = bestBin;
  bestValArr[rowIndex] = bestVal;

  // Debug: verify data was written
  let dMax = 0, dNonZero = 0;
  for (let b = 0; b < bins; b++) {
    const v = data[rowIndex * bins + b];
    if (v > dMax) dMax = v;
    if (v > 1e-15) dNonZero++;
  }
  console.log(`[updateHeatmapRow] after: dataMax=${dMax.toExponential(3)} dataNonZero=${dNonZero}/${bins}`);
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
