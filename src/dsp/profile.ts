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

  for (let i = 0; i < corr.length; i++) {
    const tau = (i / sampleRate) - tau0;
    if (tau < minTau || tau > maxTau) continue;
    inRange++;
    const R = (c * tau) / 2;
    const binPos = ((R - minR) / (maxR - minR)) * (heatBins - 1);
    const bin = clamp(Math.floor(binPos), 0, heatBins - 1);
    const v = Math.abs(corr[i]);
    if (v > corrAbsMax) corrAbsMax = v;
    if (v > prof[bin]) prof[bin] = v;
  }

  let profMax = 0, profNonZero = 0;
  for (let b = 0; b < heatBins; b++) {
    if (prof[b] > profMax) profMax = prof[b];
    if (prof[b] > 1e-15) profNonZero++;
  }

  console.log(`[buildProfile] tau0=${tau0.toFixed(6)} minTau=${minTau.toFixed(6)} maxTau=${maxTau.toFixed(6)} iRange=[${iMinExpected}..${iMaxExpected}] corrLen=${corr.length} samplesInRange=${inRange} corrAbsMaxInRange=${corrAbsMax.toExponential(3)} corrAbsMaxAll=${corrAbsMaxAll.toExponential(3)} corrAbsMaxIdx=${corrAbsMaxIdx} profMax=${profMax.toExponential(3)} profNonZero=${profNonZero}/${heatBins}`);

  return prof;
}
