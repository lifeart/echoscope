import { median, mad, clamp } from '../utils.js';
import { fftCorrelate } from '../dsp/fft-correlate.js';
import { absMaxNormalize } from '../dsp/normalize.js';
import { findPeakAbs } from '../dsp/peak.js';
import { designBandpass, applyBandpass, type BandpassCoeffs } from '../dsp/bandpass.js';
import { assessMonoDecision } from './mono-detect.js';
import { computeCalibQuality } from './quality-score.js';
import { softFilterRepeats, type RepeatMeasurement } from './engine.js';
import { BAND_CALIB } from '../constants.js';
import type { BandConfig, BandCalibrationResult } from '../types.js';

// ---------- internal helpers (same logic as engine.ts, refactored for reuse) ----------

interface GolaySumResult { corr: Float32Array; rawPeak: number }

function golaySumCorrelation(
  micWinA: Float32Array, micWinB: Float32Array,
  a: Float32Array, b: Float32Array, sampleRate: number,
): GolaySumResult {
  const corrA = fftCorrelate(micWinA, a, sampleRate).correlation;
  const corrB = fftCorrelate(micWinB, b, sampleRate).correlation;
  const L = Math.min(corrA.length, corrB.length);
  const sum = new Float32Array(L);
  for (let i = 0; i < L; i++) sum[i] = corrA[i] + corrB[i];
  let rawPeak = 0;
  for (let i = 0; i < L; i++) { const v = Math.abs(sum[i]); if (v > rawPeak) rawPeak = v; }
  absMaxNormalize(sum);
  return { corr: sum, rawPeak };
}

function correlationQuality(corr: Float32Array, peakIdx: number, sampleRate: number): number {
  const guard = Math.max(3, Math.floor(sampleRate * 0.0005));
  let sumSq = 0, n = 0;
  for (let i = 0; i < corr.length; i++) {
    if (Math.abs(i - peakIdx) <= guard) continue;
    sumSq += corr[i] * corr[i];
    n++;
  }
  if (n === 0) return 0;
  return clamp(1 - 2.5 * Math.sqrt(sumSq / n), 0, 1);
}

interface CandidatePeak { idx: number; tau: number; absVal: number }

function findCandidatePeaks(
  corr: Float32Array, earlyMs: number, sampleRate: number, maxPeaks = 15,
): CandidatePeak[] {
  const earlyEnd = Math.min(corr.length, Math.floor(sampleRate * (earlyMs / 1000)));
  let globalMax = 0;
  for (let i = 0; i < earlyEnd; i++) { const v = Math.abs(corr[i]); if (v > globalMax) globalMax = v; }
  if (globalMax < 1e-9) return [];

  const threshold = 0.15 * globalMax;
  const allPeaks: CandidatePeak[] = [];
  for (let i = 1; i < earlyEnd - 1; i++) {
    const v = Math.abs(corr[i]);
    if (v >= threshold && v >= Math.abs(corr[i - 1]) && v >= Math.abs(corr[i + 1])) {
      allPeaks.push({ idx: i, tau: i / sampleRate, absVal: v });
    }
  }
  if (allPeaks.length <= maxPeaks) return allPeaks;

  allPeaks.sort((a, b) => a.idx - b.idx);
  const earlyThresh = 0.20 * globalMax;
  const minSepSamples = Math.floor(sampleRate * 0.00025);
  const earlySet: CandidatePeak[] = [];
  for (const p of allPeaks) {
    if (earlySet.length >= 5) break;
    if (p.absVal < earlyThresh) continue;
    if (earlySet.length > 0 && (p.idx - earlySet[earlySet.length - 1].idx) < minSepSamples) continue;
    earlySet.push(p);
  }
  const earlyIdxs = new Set(earlySet.map(p => p.idx));
  const rest = allPeaks.filter(p => !earlyIdxs.has(p.idx));
  rest.sort((a, b) => b.absVal - a.absVal);
  return [...earlySet, ...rest.slice(0, maxPeaks - earlySet.length)];
}

function selectTDOAPair(
  peaksL: CandidatePeak[], peaksR: CandidatePeak[],
  maxTDOA: number, anchorTau?: number, anchorWin?: number,
): { tauL: number; tauR: number; peakL: number; peakR: number; idxL: number; idxR: number } | null {
  if (peaksL.length === 0 || peaksR.length === 0) return null;
  const validPairs: Array<{
    tauL: number; tauR: number; peakL: number; peakR: number;
    idxL: number; idxR: number; score: number; avgTau: number;
  }> = [];
  for (const pL of peaksL) {
    for (const pR of peaksR) {
      if (Math.abs(pL.tau - pR.tau) > maxTDOA) continue;
      const avgTau = (pL.tau + pR.tau) / 2;
      if (anchorTau !== undefined && anchorWin !== undefined) {
        if (Math.abs(avgTau - anchorTau) > anchorWin) continue;
      }
      validPairs.push({
        tauL: pL.tau, tauR: pR.tau, peakL: pL.absVal, peakR: pR.absVal,
        idxL: pL.idx, idxR: pR.idx, score: pL.absVal + pR.absVal, avgTau,
      });
    }
  }
  if (validPairs.length === 0) return null;
  const maxScore = Math.max(...validPairs.map(p => p.score));
  const strong = validPairs.filter(p => p.score >= 0.30 * maxScore);
  if (anchorTau !== undefined) {
    strong.sort((a, b) => {
      const distA = Math.abs(a.avgTau - anchorTau);
      const distB = Math.abs(b.avgTau - anchorTau);
      if (Math.abs(distA - distB) > 1e-9) return distA - distB;
      if (Math.abs(a.avgTau - b.avgTau) > 1e-9) return a.avgTau - b.avgTau;
      return b.score - a.score;
    });
  } else {
    strong.sort((a, b) => {
      if (Math.abs(a.avgTau - b.avgTau) > 1e-9) return a.avgTau - b.avgTau;
      return b.score - a.score;
    });
  }
  const p = strong[0];
  return { tauL: p.tauL, tauR: p.tauR, peakL: p.peakL, peakR: p.peakR, idxL: p.idxL, idxR: p.idxR };
}

function earlyPeakFromCorrelation(
  sumCorr: Float32Array, earlyMs: number, sampleRate: number,
): { idx: number; tau: number; peak: number } {
  const earlyEnd = Math.min(sumCorr.length, Math.floor(sampleRate * (earlyMs / 1000)));
  const pk = findPeakAbs(sumCorr, 0, earlyEnd);
  if (pk.absValue < 1e-9) return { idx: 0, tau: 0, peak: 0 };
  const threshold = 0.35 * pk.absValue;
  for (let i = 1; i < earlyEnd - 1; i++) {
    const v = Math.abs(sumCorr[i]);
    if (v >= threshold && v >= Math.abs(sumCorr[i - 1]) && v >= Math.abs(sumCorr[i + 1])) {
      return { idx: i, tau: i / sampleRate, peak: v };
    }
  }
  return { idx: pk.index, tau: pk.index / sampleRate, peak: pk.absValue };
}

// ---------- Captured raw data for a single ping ----------

/** Raw mic captures for one L/R Golay ping (A+B per side) */
export interface RawPingCapture {
  micLA: Float32Array;
  micLB: Float32Array;
  micRA: Float32Array;
  micRB: Float32Array;
}

// ---------- Filter cache ----------

const filterCache = new Map<string, BandpassCoeffs>();

function getOrDesignFilter(band: BandConfig, sampleRate: number): BandpassCoeffs {
  const key = `${band.id}:${sampleRate}`;
  let coeffs = filterCache.get(key);
  if (!coeffs) {
    coeffs = designBandpass(band.fLow, band.fHigh, sampleRate, band.filterTaps);
    filterCache.set(key, coeffs);
  }
  return coeffs;
}

// ---------- Per-band calibration ----------

/**
 * Run the full calibration pipeline on a single frequency band.
 *
 * Takes pre-captured raw mic data (pilot pings + repeat pings),
 * filters them into the band, and runs pilot clustering + repeat
 * measurement + soft-filter + metrics.
 *
 * This is the "BandRunner" from the multiband architecture plan.
 */
export function runBandCalibration(
  band: BandConfig,
  pilotCaptures: RawPingCapture[],
  repeatCaptures: RawPingCapture[],
  golayA: Float32Array,
  golayB: Float32Array,
  sampleRate: number,
  d: number,
  c: number,
): BandCalibrationResult {
  const maxTDOA = d / c + 2 / sampleRate;
  const earlyMs = BAND_CALIB.EARLY_MS;
  const coeffs = getOrDesignFilter(band, sampleRate);

  // --- Pilot phase (per band): filter captures and extract all TDOA pairs ---
  const pilotMeasurements: Array<{ meanTau: number; score: number }> = [];

  for (const cap of pilotCaptures) {
    const filtLA = applyBandpass(cap.micLA, coeffs);
    const filtLB = applyBandpass(cap.micLB, coeffs);
    const filtRA = applyBandpass(cap.micRA, coeffs);
    const filtRB = applyBandpass(cap.micRB, coeffs);

    const resL = golaySumCorrelation(filtLA, filtLB, golayA, golayB, sampleRate);
    const resR = golaySumCorrelation(filtRA, filtRB, golayA, golayB, sampleRate);

    const candsL = findCandidatePeaks(resL.corr, earlyMs, sampleRate);
    const candsR = findCandidatePeaks(resR.corr, earlyMs, sampleRate);

    for (const cL of candsL) {
      for (const cR of candsR) {
        if (Math.abs(cL.tau - cR.tau) > maxTDOA) continue;
        const meanTau = (cL.tau + cR.tau) / 2;
        const corrQL = correlationQuality(resL.corr, cL.idx, sampleRate);
        const corrQR = correlationQuality(resR.corr, cR.idx, sampleRate);
        const score = Math.min(cL.absVal, cR.absVal) * Math.sqrt(corrQL * corrQR);
        if (score > 0.01) pilotMeasurements.push({ meanTau, score });
      }
    }
  }

  // Two-pass pilot clustering
  let pilotTau = 0;
  let pilotAboveFloor = false;
  let pilotClusterMad = 0;
  let pilotClusterSize = 0;

  function clusterPilot(measurements: typeof pilotMeasurements): { cluster: typeof pilotMeasurements; medianTau: number } | null {
    if (measurements.length === 0) return null;
    if (measurements.length === 1) return { cluster: measurements, medianTau: measurements[0].meanTau };

    let best: typeof pilotMeasurements = [];
    let bestScore = 0;
    for (const pm of measurements) {
      const members = measurements.filter(r => Math.abs(r.meanTau - pm.meanTau) <= BAND_CALIB.PILOT_CLUSTER_WIN);
      if (members.length < 2) continue;
      const mTaus = members.map(r => r.meanTau);
      const center = median(mTaus);
      const verified = members.filter(r => Math.abs(r.meanTau - center) <= BAND_CALIB.PILOT_CLUSTER_WIN);
      const totalScore = verified.reduce((s, m) => s + m.score, 0);
      if (verified.length > best.length ||
          (verified.length === best.length && totalScore > bestScore) ||
          (verified.length === best.length && Math.abs(totalScore - bestScore) < 0.001 &&
           median(verified.map(r => r.meanTau)) < median(best.map(r => r.meanTau)))) {
        best = verified;
        bestScore = totalScore;
      }
    }
    if (best.length === 0) {
      const sorted = [...measurements].sort((a, b) => b.score - a.score);
      return { cluster: [sorted[0]], medianTau: sorted[0].meanTau };
    }
    return { cluster: best, medianTau: median(best.map(r => r.meanTau)) };
  }

  if (pilotMeasurements.length === 0) {
    // No valid pairs at all in this band — mark as invalid
    return makeBandResult(band, false);
  }

  // Pass 1: cluster above TAU_MIN_ACOUSTIC
  const acoustic = pilotMeasurements.filter(m => m.meanTau >= BAND_CALIB.TAU_MIN_ACOUSTIC);
  const pass1 = clusterPilot(acoustic);

  if (pass1 && pass1.cluster.length >= 2) {
    pilotTau = pass1.medianTau;
    pilotAboveFloor = true;
    const taus = pass1.cluster.map(m => m.meanTau);
    pilotClusterMad = taus.length > 1 ? mad(taus, pilotTau) : 0;
    pilotClusterSize = pass1.cluster.length;
  } else {
    // Pass 2: fall back to all measurements
    const pass2 = clusterPilot(pilotMeasurements)!;
    pilotTau = pass2.medianTau;
    const taus = pass2.cluster.map(m => m.meanTau);
    pilotClusterMad = taus.length > 1 ? mad(taus, pilotTau) : 0;
    pilotClusterSize = pass2.cluster.length;
  }

  // Adaptive pilot window
  let pilotWin: number;
  if (pilotAboveFloor) {
    pilotWin = clamp(2.5 * pilotClusterMad, 0.00025, 0.0005);
  } else {
    pilotWin = clamp(2.5 * pilotClusterMad, 0.0005, 0.0008);
  }

  // --- Repeat measurements (per band) ---
  const allRepeats: RepeatMeasurement[] = [];

  for (const cap of repeatCaptures) {
    const filtLA = applyBandpass(cap.micLA, coeffs);
    const filtLB = applyBandpass(cap.micLB, coeffs);
    const filtRA = applyBandpass(cap.micRA, coeffs);
    const filtRB = applyBandpass(cap.micRB, coeffs);

    const resL = golaySumCorrelation(filtLA, filtLB, golayA, golayB, sampleRate);
    const resR = golaySumCorrelation(filtRA, filtRB, golayA, golayB, sampleRate);

    const candsL = findCandidatePeaks(resL.corr, earlyMs, sampleRate);
    const candsR = findCandidatePeaks(resR.corr, earlyMs, sampleRate);
    const tdoaPair = selectTDOAPair(candsL, candsR, maxTDOA, pilotTau, pilotWin);

    if (tdoaPair) {
      const corrQualL = correlationQuality(resL.corr, tdoaPair.idxL, sampleRate);
      const corrQualR = correlationQuality(resR.corr, tdoaPair.idxR, sampleRate);
      const pairDelta = Math.abs(tdoaPair.tauL - tdoaPair.tauR);
      const tdoaRatio = pairDelta / maxTDOA;
      allRepeats.push({ tauL: tdoaPair.tauL, tauR: tdoaPair.tauR, qualL: corrQualL, qualR: corrQualR, tdoaRatio, valid: true });
    } else {
      const mL = earlyPeakFromCorrelation(resL.corr, earlyMs, sampleRate);
      const mR = earlyPeakFromCorrelation(resR.corr, earlyMs, sampleRate);
      allRepeats.push({ tauL: mL.tau, tauR: mR.tau, qualL: 0, qualR: 0, tdoaRatio: Infinity, valid: false });
    }
  }

  // --- Cluster valid repeats ---
  const validRepeats = allRepeats.filter(r => r.valid);
  let bestCluster: RepeatMeasurement[] = [];

  for (let i = 0; i < validRepeats.length; i++) {
    const seedMean = (validRepeats[i].tauL + validRepeats[i].tauR) / 2;
    const members = validRepeats.filter(r => {
      const mean = (r.tauL + r.tauR) / 2;
      return Math.abs(mean - seedMean) <= BAND_CALIB.CLUSTER_WINDOW;
    });
    if (members.length < 2) {
      if (members.length > bestCluster.length) bestCluster = members;
      continue;
    }
    const memberMeans = members.map(r => (r.tauL + r.tauR) / 2);
    const clusterCenter = median(memberMeans);
    const verified = members.filter(r => {
      const mean = (r.tauL + r.tauR) / 2;
      return Math.abs(mean - clusterCenter) <= BAND_CALIB.CLUSTER_WINDOW;
    });
    if (verified.length > bestCluster.length ||
        (verified.length === bestCluster.length && verified.length > 0 &&
         median(verified.map(r => (r.tauL + r.tauR) / 2)) <
         median(bestCluster.map(r => (r.tauL + r.tauR) / 2)))) {
      bestCluster = verified;
    }
  }

  const softFilteredCount = bestCluster.length;
  bestCluster = softFilterRepeats(bestCluster, maxTDOA);
  const actualSoftFiltered = softFilteredCount - bestCluster.length;

  const clusterSize = bestCluster.length;
  const tauLArr = bestCluster.map(r => r.tauL);
  const tauRArr = bestCluster.map(r => r.tauR);
  const pkLArr = bestCluster.map(r => r.qualL);
  const pkRArr = bestCluster.map(r => r.qualR);

  const medTauL = tauLArr.length > 0 ? median(tauLArr) : 0;
  const medTauR = tauRArr.length > 0 ? median(tauRArr) : 0;
  const medPkL = pkLArr.length > 0 ? median(pkLArr) : 0;
  const medPkR = pkRArr.length > 0 ? median(pkRArr) : 0;
  const madTauL = tauLArr.length > 1 ? mad(tauLArr, medTauL) : Infinity;
  const madTauR = tauRArr.length > 1 ? mad(tauRArr, medTauR) : Infinity;

  const deltaTau = medTauR - medTauL;
  const perRepeatDeltas = bestCluster.map(r => r.tauR - r.tauL);
  const medDelta = perRepeatDeltas.length > 0 ? median(perRepeatDeltas) : 0;
  const madDelta = perRepeatDeltas.length > 1 ? mad(perRepeatDeltas, medDelta) : Infinity;
  const deltaConsistency = Number.isFinite(madDelta) ? madDelta / maxTDOA : 1.0;
  const maxDeltaDev = perRepeatDeltas.length > 0
    ? Math.max(...perRepeatDeltas.map(d => Math.abs(d - medDelta))) / maxTDOA : 0;

  const mono = assessMonoDecision(medTauL, medTauR, medPkL, medPkR, d, c);

  const quality = computeCalibQuality({
    tauMadL: madTauL, tauMadR: madTauR,
    peakL: medPkL, peakR: medPkR,
    geomErr: deltaConsistency, monoLikely: mono.monoLikely,
  });

  // Validity gates (same as main engine)
  const maxMadMs = Number.isFinite(madTauL) && Number.isFinite(madTauR)
    ? 1000 * Math.max(madTauL, madTauR) : Infinity;
  const measurementsStable = maxMadMs < 2.0;
  const deltaConsistent = deltaConsistency < 0.3;
  const enoughRepeats = clusterSize >= 2;
  const corrQualOk = medPkL > 0.15 && medPkR > 0.15;
  const valid = enoughRepeats && measurementsStable && corrQualOk && deltaConsistent && quality > 0.15;
  const angleReliable = valid && maxDeltaDev < 0.6;

  console.debug(`[calib:band:${band.id}] pilot: tau=${(pilotTau * 1000).toFixed(3)}ms mad=${(pilotClusterMad * 1000).toFixed(3)}ms cluster=${pilotClusterSize} aboveFloor=${pilotAboveFloor}`);
  console.debug(`[calib:band:${band.id}] repeats: cluster=${clusterSize}/${validRepeats.length}/${allRepeats.length} softFiltered=${actualSoftFiltered} quality=${quality.toFixed(3)} valid=${valid}`);
  console.debug(`[calib:band:${band.id}] deltaConsistency=${deltaConsistency.toFixed(4)} maxDeltaDev=${maxDeltaDev.toFixed(4)} angleReliable=${angleReliable}`);

  return {
    bandId: band.id,
    bandHz: [band.fLow, band.fHigh],
    valid,
    quality,
    angleReliable,
    pilotTau,
    pilotMAD: pilotClusterMad,
    pilotClusterSize,
    pilotAboveFloor,
    pilotWin,
    repeatClusterSize: clusterSize,
    softFilteredCount: actualSoftFiltered,
    deltaConsistency,
    maxDeltaDev,
    corrQualOk,
    tauMeasured: { L: medTauL, R: medTauR },
    tauMAD: { L: madTauL, R: madTauR },
    peaks: { L: medPkL, R: medPkR },
    deltaTau,
    monoLikely: mono.monoLikely,
  };
}

/** Helper to produce an empty/invalid band result */
function makeBandResult(band: BandConfig, valid: boolean): BandCalibrationResult {
  return {
    bandId: band.id,
    bandHz: [band.fLow, band.fHigh],
    valid,
    quality: 0,
    angleReliable: false,
    pilotTau: 0,
    pilotMAD: Infinity,
    pilotClusterSize: 0,
    pilotAboveFloor: false,
    pilotWin: 0,
    repeatClusterSize: 0,
    softFilteredCount: 0,
    deltaConsistency: 1.0,
    maxDeltaDev: 0,
    corrQualOk: false,
    tauMeasured: { L: 0, R: 0 },
    tauMAD: { L: Infinity, R: Infinity },
    peaks: { L: 0, R: 0 },
    deltaTau: 0,
    monoLikely: false,
  };
}
