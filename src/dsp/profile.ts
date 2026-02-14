import { clamp } from '../utils.js';

export function buildRangeProfileFromCorrelation(
  corr: Float32Array,
  tau0: number,
  c: number,
  minR: number,
  maxR: number,
  sampleRate: number,
  heatBins: number,
  debugLog = true,
): Float32Array {
  if (heatBins <= 0) return new Float32Array(0);
  const prof = new Float32Array(heatBins);
  if (!corr || corr.length === 0) return prof;
  if (sampleRate <= 0) return prof;
  if (!(Number.isFinite(c) && c > 0 && Number.isFinite(minR) && Number.isFinite(maxR) && maxR > minR)) return prof;

  const minTau = (2 * minR) / c;
  const maxTau = (2 * maxR) / c;

  // Debug: check correlation stats in the tau window
  let inRange = 0;
  let corrAbsMax = 0;
  let corrAbsMaxAll = 0;
  let corrAbsMaxIdx = -1;
  const iMinExpected = Math.floor((tau0 + minTau) * sampleRate);
  const iMaxExpected = Math.ceil((tau0 + maxTau) * sampleRate);

  for (let i = 0; i < corr.length; i++) {
    const av = Math.abs(corr[i]);
    if (av > corrAbsMaxAll) { corrAbsMaxAll = av; corrAbsMaxIdx = i; }
  }

  // Triangular bin splatting: distribute each sample's energy across two neighboring bins
  const counts = new Float32Array(heatBins);

  for (let i = 0; i < corr.length; i++) {
    const tau = (i / sampleRate) - tau0;
    if (tau < minTau || tau > maxTau) continue;
    inRange++;
    const R = (c * tau) / 2;
    const binPos = ((R - minR) / (maxR - minR)) * (heatBins - 1);
    const bin0 = clamp(Math.floor(binPos), 0, heatBins - 1);
    const bin1 = Math.min(bin0 + 1, heatBins - 1);
    const frac = binPos - bin0;
    const v = Math.abs(corr[i]);
    if (v > corrAbsMax) corrAbsMax = v;
    prof[bin0] += v * (1 - frac);
    counts[bin0] += (1 - frac);
    if (bin0 !== bin1) {
      prof[bin1] += v * frac;
      counts[bin1] += frac;
    }
  }

  // Average accumulated values
  for (let b = 0; b < heatBins; b++) {
    if (counts[b] > 0) prof[b] /= counts[b];
  }

  let profMax = 0, profNonZero = 0;
  for (let b = 0; b < heatBins; b++) {
    if (prof[b] > profMax) profMax = prof[b];
    if (prof[b] > 1e-15) profNonZero++;
  }

  if (debugLog) {
    console.log(`[buildProfile] tau0=${tau0.toFixed(6)} minTau=${minTau.toFixed(6)} maxTau=${maxTau.toFixed(6)} iRange=[${iMinExpected}..${iMaxExpected}] corrLen=${corr.length} samplesInRange=${inRange} corrAbsMaxInRange=${corrAbsMax.toExponential(3)} corrAbsMaxAll=${corrAbsMaxAll.toExponential(3)} corrAbsMaxIdx=${corrAbsMaxIdx} profMax=${profMax.toExponential(3)} profNonZero=${profNonZero}/${heatBins}`);
  }

  return prof;
}
