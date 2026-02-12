import { clamp } from '../utils.js';

export function buildRangeProfileFromCorrelation(
  corr: Float32Array,
  tau0: number,
  c: number,
  minR: number,
  maxR: number,
  sampleRate: number,
  heatBins: number,
): Float32Array {
  if (heatBins <= 0) return new Float32Array(0);
  const prof = new Float32Array(heatBins);
  if (!corr || corr.length === 0) return prof;
  if (sampleRate <= 0) return prof;
  if (!(Number.isFinite(c) && c > 0 && Number.isFinite(minR) && Number.isFinite(maxR) && maxR > minR)) return prof;

  const minTau = (2 * minR) / c;
  const maxTau = (2 * maxR) / c;

  for (let i = 0; i < corr.length; i++) {
    const tau = (i / sampleRate) - tau0;
    if (tau < minTau || tau > maxTau) continue;
    const R = (c * tau) / 2;
    const binPos = ((R - minR) / (maxR - minR)) * (heatBins - 1);
    const bin = clamp(Math.floor(binPos), 0, heatBins - 1);
    const v = Math.abs(corr[i]);
    if (v > prof[bin]) prof[bin] = v;
  }

  return prof;
}
