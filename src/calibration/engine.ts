import { store } from '../core/store.js';
import { bus } from '../core/event-bus.js';
import { sleep, median, mad } from '../utils.js';
import { clamp } from '../utils.js';
import { fftCorrelate } from '../dsp/fft-correlate.js';
import { absMaxNormalize } from '../dsp/normalize.js';
import { measureRoundTripLatency } from '../audio/latency.js';
import { findPeakAbs } from '../dsp/peak.js';
import { buildRangeProfileFromCorrelation } from '../dsp/profile.js';
import { applyQualityAlgorithms } from '../dsp/quality.js';
import { genGolayChipped } from '../signal/golay.js';
import { pingAndCaptureOneSide, pingAndCaptureSteered } from '../spatial/steering.js';
import { getSampleRate } from '../audio/engine.js';
import { assessMonoDecision } from './mono-detect.js';
import { computeCalibQuality } from './quality-score.js';
import { computeEnvBaseline } from './env-baseline.js';
import { estimateMicXY } from '../spatial/geometry.js';
import type { CalibrationResult, CalibrationSanity, GolayConfig } from '../types.js';

interface GolaySumResult {
  corr: Float32Array;
  rawPeak: number;
}

function golaySumCorrelation(
  micWinA: Float32Array,
  micWinB: Float32Array,
  a: Float32Array,
  b: Float32Array,
  sampleRate: number,
): GolaySumResult {
  // Sum raw correlations WITHOUT per-half normalization.
  // Golay complementary sidelobe cancellation requires summing at the same scale.
  const corrA = fftCorrelate(micWinA, a, sampleRate).correlation;
  const corrB = fftCorrelate(micWinB, b, sampleRate).correlation;
  const L = Math.min(corrA.length, corrB.length);
  const sum = new Float32Array(L);
  for (let i = 0; i < L; i++) sum[i] = corrA[i] + corrB[i];

  // Capture raw peak before normalization (SNR proxy)
  let rawPeak = 0;
  for (let i = 0; i < L; i++) {
    const v = Math.abs(sum[i]);
    if (v > rawPeak) rawPeak = v;
  }

  absMaxNormalize(sum);
  return { corr: sum, rawPeak };
}

function earlyPeakFromCorrelation(
  sumCorr: Float32Array,
  earlyMs: number,
  sampleRate: number,
): { idx: number; tau: number; peak: number } {
  const earlyEnd = Math.min(sumCorr.length, Math.floor(sampleRate * (earlyMs / 1000)));
  const pk = findPeakAbs(sumCorr, 0, earlyEnd);
  if (pk.absValue < 1e-9) return { idx: 0, tau: 0, peak: 0 };

  // Onset detection: prefer the earliest local maximum above 35% of the
  // global peak.  This prevents the correlator from locking onto a stronger
  // late reflection instead of the (possibly weaker) direct arrival.
  const threshold = 0.35 * pk.absValue;
  for (let i = 1; i < earlyEnd - 1; i++) {
    const v = Math.abs(sumCorr[i]);
    if (v >= threshold && v >= Math.abs(sumCorr[i - 1]) && v >= Math.abs(sumCorr[i + 1])) {
      return { idx: i, tau: i / sampleRate, peak: v };
    }
  }
  return { idx: pk.index, tau: pk.index / sampleRate, peak: pk.absValue };
}

/**
 * Measure correlation quality as 1 − k·sidelobeRMS (after absMaxNormalize).
 * A clean Golay-sum correlation has near-zero sidelobes → quality ≈ 1.
 * Strong reflections or noise raise the RMS → quality drops.
 */
function correlationQuality(
  corr: Float32Array,
  peakIdx: number,
  sampleRate: number,
): number {
  const guard = Math.max(3, Math.floor(sampleRate * 0.0005)); // ±0.5 ms guard
  let sumSq = 0, n = 0;
  for (let i = 0; i < corr.length; i++) {
    if (Math.abs(i - peakIdx) <= guard) continue;
    sumSq += corr[i] * corr[i];
    n++;
  }
  if (n === 0) return 0;
  const rms = Math.sqrt(sumSq / n);
  return clamp(1 - 2.5 * rms, 0, 1);
}

interface CandidatePeak {
  idx: number;
  tau: number;
  absVal: number;
}

/** Find the top N local maxima above 20% of the global max in the early window. */
function findCandidatePeaks(
  corr: Float32Array,
  earlyMs: number,
  sampleRate: number,
  maxPeaks = 5,
): CandidatePeak[] {
  const earlyEnd = Math.min(corr.length, Math.floor(sampleRate * (earlyMs / 1000)));
  let globalMax = 0;
  for (let i = 0; i < earlyEnd; i++) {
    const v = Math.abs(corr[i]);
    if (v > globalMax) globalMax = v;
  }
  if (globalMax < 1e-9) return [];

  const threshold = 0.20 * globalMax;
  const peaks: CandidatePeak[] = [];
  for (let i = 1; i < earlyEnd - 1; i++) {
    const v = Math.abs(corr[i]);
    if (v >= threshold && v >= Math.abs(corr[i - 1]) && v >= Math.abs(corr[i + 1])) {
      peaks.push({ idx: i, tau: i / sampleRate, absVal: v });
    }
  }
  peaks.sort((a, b) => b.absVal - a.absVal);
  return peaks.slice(0, maxPeaks);
}

/**
 * Select the best (τL, τR) pair that satisfies the same-wavefront TDOA
 * constraint: |τL − τR| ≤ d/c + margin.  Among valid pairs, pick the one
 * with the highest combined peak strength.
 */
function selectTDOAPair(
  peaksL: CandidatePeak[],
  peaksR: CandidatePeak[],
  maxTDOA: number,
): { tauL: number; tauR: number; peakL: number; peakR: number; idxL: number; idxR: number } | null {
  if (peaksL.length === 0 || peaksR.length === 0) return null;

  const validPairs: Array<{
    tauL: number; tauR: number; peakL: number; peakR: number;
    idxL: number; idxR: number; score: number;
  }> = [];

  for (const pL of peaksL) {
    for (const pR of peaksR) {
      if (Math.abs(pL.tau - pR.tau) > maxTDOA) continue;
      validPairs.push({
        tauL: pL.tau, tauR: pR.tau,
        peakL: pL.absVal, peakR: pR.absVal,
        idxL: pL.idx, idxR: pR.idx,
        score: pL.absVal + pR.absVal,
      });
    }
  }
  if (validPairs.length === 0) return null;

  // Among valid pairs with sufficient strength (≥30% of strongest),
  // prefer the earliest arrival.  Direct path always arrives before reflections.
  const maxScore = Math.max(...validPairs.map(p => p.score));
  const strong = validPairs.filter(p => p.score >= 0.30 * maxScore);
  strong.sort((a, b) => (a.tauL + a.tauR) - (b.tauL + b.tauR));

  const c = strong[0];
  return { tauL: c.tauL, tauR: c.tauR, peakL: c.peakL, peakR: c.peakR, idxL: c.idxL, idxR: c.idxR };
}

export function predictedTau0ForPing(
  delayL: number,
  delayR: number,
): number | null {
  const state = store.get();
  const calib = state.calibration;
  if (!calib?.valid || !state.config.calibration.useCalib) return null;
  if (calib.quality <= 0.2) return null;
  const c = state.config.speedOfSound;
  const tL = calib.systemDelay.L + delayL + (calib.distances.L / c);
  const tR = calib.systemDelay.R + delayR + (calib.distances.R / c);
  return Math.min(tL, tR);
}

export async function calibrateRefinedWithSanity(): Promise<CalibrationResult> {
  const state = store.get();
  const ctx = state.audio.context;
  if (!ctx) throw new Error('Init audio first');

  store.set('status', 'calibrating');

  const config = state.config;
  const sr = getSampleRate();
  const d = config.spacing;
  const c = config.speedOfSound;
  const gain = config.gain;
  const repeats = clamp(config.calibration.repeats, 1, 9);
  const repeatGap = Math.max(30, config.calibration.gapMs);
  const extraCalPings = clamp(config.envBaseline.pings, 0, 12);
  const minR = config.minRange;
  const maxR = config.maxRange;
  const heatBins = config.heatBins;

  if (!(d > 0.02)) throw new Error('Speaker spacing d must be set (meters)');
  if (!(c > 200 && c < 400)) throw new Error('Speed of sound c looks wrong');

  const { baseLatency, outputLatency } = state.audio;
  const rtLatencyMs = measureRoundTripLatency(baseLatency, outputLatency);

  const earlyMs = 60;
  const golayConfig: GolayConfig = {
    order: (config.probe.type === 'golay') ? config.probe.params.order : 10,
    chipRate: (config.probe.type === 'golay') ? config.probe.params.chipRate : 5000,
    gapMs: (config.probe.type === 'golay') ? config.probe.params.gapMs : 12,
  };
  const { a, b } = genGolayChipped(golayConfig, sr);
  const gapMs = golayConfig.gapMs;

  // Ensure enough capture for earlyMs of correlation beyond the Golay reference length
  const golayDurMs = a.length / sr * 1000;
  const listenMs = Math.max(golayDurMs + earlyMs + 20, config.listenMs);

  console.debug(`[calib] starting: sr=${sr} d=${d.toFixed(3)}m c=${c.toFixed(1)} gain=${gain.toFixed(2)} repeats=${repeats} listenMs=${listenMs.toFixed(0)} envPings=${extraCalPings}`);
  console.debug(`[calib] audio latency: base=${(baseLatency * 1000).toFixed(2)}ms output=${(outputLatency * 1000).toFixed(2)}ms roundTrip=${rtLatencyMs.toFixed(2)}ms`);
  console.debug(`[calib] golay: order=${golayConfig.order} chipRate=${golayConfig.chipRate} refLen=${a.length} (${golayDurMs.toFixed(1)}ms) gapMs=${gapMs}`);

  // Max TDOA for same wavefront: d/c + 0.3ms margin
  const maxTDOA = d / c + 0.0003;

  const tauL: number[] = [], tauR: number[] = [];
  const pkL: number[] = [], pkR: number[] = [];

  for (let k = 0; k < repeats; k++) {
    // --- Capture L channel ---
    const capLA = await pingAndCaptureOneSide(a, 'L', gain, listenMs);
    await sleep(Math.max(0, gapMs));
    const capLB = await pingAndCaptureOneSide(b, 'L', gain, listenMs);
    const resL = golaySumCorrelation(capLA.micWin, capLB.micWin, a, b, sr);

    await sleep(repeatGap);

    // --- Capture R channel ---
    const capRA = await pingAndCaptureOneSide(a, 'R', gain, listenMs);
    await sleep(Math.max(0, gapMs));
    const capRB = await pingAndCaptureOneSide(b, 'R', gain, listenMs);
    const resR = golaySumCorrelation(capRA.micWin, capRB.micWin, a, b, sr);

    // --- Joint peak selection with TDOA gate ---
    const candsL = findCandidatePeaks(resL.corr, earlyMs, sr);
    const candsR = findCandidatePeaks(resR.corr, earlyMs, sr);
    const tdoaPair = selectTDOAPair(candsL, candsR, maxTDOA);

    let chosenTauL: number, chosenTauR: number;
    let chosenIdxL: number, chosenIdxR: number;

    if (tdoaPair) {
      chosenTauL = tdoaPair.tauL;
      chosenTauR = tdoaPair.tauR;
      chosenIdxL = tdoaPair.idxL;
      chosenIdxR = tdoaPair.idxR;
      const delta = Math.abs(tdoaPair.tauL - tdoaPair.tauR) * 1000;
      console.debug(`[calib] repeat ${k + 1}/${repeats} TDOA gate: L@${(tdoaPair.tauL * 1000).toFixed(3)}ms(pk=${tdoaPair.peakL.toFixed(3)}) R@${(tdoaPair.tauR * 1000).toFixed(3)}ms(pk=${tdoaPair.peakR.toFixed(3)}) delta=${delta.toFixed(3)}ms maxTDOA=${(maxTDOA * 1000).toFixed(3)}ms candsL=${candsL.length} candsR=${candsR.length}`);
    } else {
      // Fallback: onset detection per channel (no valid TDOA pair found)
      const mL = earlyPeakFromCorrelation(resL.corr, earlyMs, sr);
      const mR = earlyPeakFromCorrelation(resR.corr, earlyMs, sr);
      chosenTauL = mL.tau;
      chosenTauR = mR.tau;
      chosenIdxL = mL.idx;
      chosenIdxR = mR.idx;
      console.debug(`[calib] repeat ${k + 1}/${repeats} TDOA gate: NO valid pair (candsL=${candsL.length} candsR=${candsR.length}), onset fallback: L@${(mL.tau * 1000).toFixed(3)}ms R@${(mR.tau * 1000).toFixed(3)}ms`);
    }

    // Compute correlation quality (sidelobe RMS metric)
    const corrQualL = correlationQuality(resL.corr, chosenIdxL, sr);
    const corrQualR = correlationQuality(resR.corr, chosenIdxR, sr);
    tauL.push(chosenTauL); pkL.push(corrQualL);
    tauR.push(chosenTauR); pkR.push(corrQualR);
    console.debug(`[calib] repeat ${k + 1}/${repeats} quality: corrQualL=${corrQualL.toFixed(4)} corrQualR=${corrQualR.toFixed(4)} rawPeakL=${resL.rawPeak.toFixed(1)} rawPeakR=${resR.rawPeak.toFixed(1)} corrLenL=${resL.corr.length} corrLenR=${resR.corr.length}`);

    await sleep(repeatGap);
  }

  const medTauL = median(tauL);
  const medTauR = median(tauR);
  const medPkL = median(pkL);
  const medPkR = median(pkR);
  const madTauL = mad(tauL, medTauL);
  const madTauR = mad(tauR, medTauR);

  console.debug(`[calib] statistics: medTauL=${(medTauL * 1000).toFixed(4)}ms medTauR=${(medTauR * 1000).toFixed(4)}ms madL=${(madTauL * 1000).toFixed(4)}ms madR=${(madTauR * 1000).toFixed(4)}ms`);
  console.debug(`[calib] correlation quality: medCorrQualL=${medPkL.toFixed(4)} medCorrQualR=${medPkR.toFixed(4)}`);
  console.debug(`[calib] raw tauL=[${tauL.map(t => (t * 1000).toFixed(3)).join(', ')}]ms tauR=[${tauR.map(t => (t * 1000).toFixed(3)).join(', ')}]ms`);

  const rMin = 0.04;
  const tauSysCommon = Math.max(0, Math.min(medTauL, medTauR) - (rMin / c));

  let rL = c * Math.max(0, medTauL - tauSysCommon);
  let rR = c * Math.max(0, medTauR - tauSysCommon);
  rL = Math.max(rMin, rL);
  rR = Math.max(rMin, rR);

  const geo = estimateMicXY(rL, rR, d);
  const tauSysL = Math.max(0, medTauL - (rL / c));
  const tauSysR = Math.max(0, medTauR - (rR / c));

  console.debug(`[calib] distances: rL=${rL.toFixed(4)}m rR=${rR.toFixed(4)}m tauSysCommon=${(tauSysCommon * 1000).toFixed(4)}ms`);
  console.debug(`[calib] system delays: L=${(tauSysL * 1000).toFixed(4)}ms R=${(tauSysR * 1000).toFixed(4)}ms delta=${((tauSysL - tauSysR) * 1000).toFixed(4)}ms`);
  console.debug(`[calib] geometry: mic=(${geo.x.toFixed(4)}, ${geo.y.toFixed(4)}) err=${geo.err.toFixed(4)} spacing=${d.toFixed(3)}m`);

  const mono = assessMonoDecision(medTauL, medTauR, medPkL, medPkR, d, c);
  console.debug(`[calib] mono assessment: monoLikely=${mono.monoLikely} dt=${(mono.dt * 1000).toFixed(4)}ms dp=${mono.dp.toFixed(4)} monoByTime=${mono.monoByTime} monoByPeak=${mono.monoByPeak}`);

  const quality = computeCalibQuality({
    tauMadL: madTauL, tauMadR: madTauR,
    peakL: medPkL, peakR: medPkR,
    geomErr: geo.err, monoLikely: mono.monoLikely,
  });
  console.debug(`[calib] quality score: ${quality.toFixed(4)}`);

  // Sanity capture
  const capLA = await pingAndCaptureOneSide(a, 'L', gain, listenMs);
  await sleep(Math.max(0, gapMs));
  const capLB = await pingAndCaptureOneSide(b, 'L', gain, listenMs);
  const resLSanity = golaySumCorrelation(capLA.micWin, capLB.micWin, a, b, sr);

  await sleep(repeatGap); // gap between L/R to avoid residual reverberation contamination

  const capRA = await pingAndCaptureOneSide(a, 'R', gain, listenMs);
  await sleep(Math.max(0, gapMs));
  const capRB = await pingAndCaptureOneSide(b, 'R', gain, listenMs);
  const resRSanity = golaySumCorrelation(capRA.micWin, capRB.micWin, a, b, sr);

  const earlyNL = Math.min(resLSanity.corr.length, Math.floor(sr * (earlyMs / 1000)));
  const earlyNR = Math.min(resRSanity.corr.length, Math.floor(sr * (earlyMs / 1000)));
  const curveL = resLSanity.corr.slice(0, earlyNL);
  const curveR = resRSanity.corr.slice(0, earlyNR);

  // Use TDOA-gated peak selection for sanity check too
  const sanityCandL = findCandidatePeaks(resLSanity.corr, earlyMs, sr);
  const sanityCandR = findCandidatePeaks(resRSanity.corr, earlyMs, sr);
  const sanityPair = selectTDOAPair(sanityCandL, sanityCandR, maxTDOA);

  let sanityTauL: number, sanityTauR: number;
  let sanityPkL: number, sanityPkR: number;
  let sanityIdxL: number, sanityIdxR: number;

  if (sanityPair) {
    sanityTauL = sanityPair.tauL; sanityTauR = sanityPair.tauR;
    sanityPkL = sanityPair.peakL; sanityPkR = sanityPair.peakR;
    sanityIdxL = sanityPair.idxL; sanityIdxR = sanityPair.idxR;
  } else {
    const sL = earlyPeakFromCorrelation(resLSanity.corr, earlyMs, sr);
    const sR = earlyPeakFromCorrelation(resRSanity.corr, earlyMs, sr);
    sanityTauL = sL.tau; sanityTauR = sR.tau;
    sanityPkL = sL.peak; sanityPkR = sR.peak;
    sanityIdxL = sL.idx; sanityIdxR = sR.idx;
  }

  const mono2 = assessMonoDecision(
    sanityTauL, sanityTauR,
    sanityPkL, sanityPkR, d, c,
  );

  console.debug(`[calib] sanity check: tauL=${(sanityTauL * 1000).toFixed(4)}ms tauR=${(sanityTauR * 1000).toFixed(4)}ms peakL=${sanityPkL.toFixed(4)} peakR=${sanityPkR.toFixed(4)} tdoaGated=${!!sanityPair} mono=${mono2.monoLikely}`);

  const sanity: CalibrationSanity = {
    have: true,
    curveL, curveR,
    peakIndexL: sanityIdxL, peakIndexR: sanityIdxR,
    earlyMs,
    tauL: sanityTauL, tauR: sanityTauR,
    peakL: sanityPkL, peakR: sanityPkR,
    monoAssessment: mono2,
  };

  // Env baseline
  let envBaseline: Float32Array | null = null;
  let envBaselinePings = 0;
  if (extraCalPings > 0 && Number.isFinite(minR) && Number.isFinite(maxR) && maxR > minR) {
    const profiles: Float32Array[] = [];
    for (let i = 0; i < extraCalPings; i++) {
      // Capture at theta=0 using steered stereo Golay (both speakers active)
      const cA = await pingAndCaptureSteered(a, 0, gain, listenMs);
      await sleep(Math.max(0, gapMs));
      const cB = await pingAndCaptureSteered(b, 0, gain, listenMs);
      const envRes = golaySumCorrelation(cA.micWin, cB.micWin, a, b, sr);
      const envTau0 = 0.5 * (medTauL + medTauR);
      let prof = buildRangeProfileFromCorrelation(envRes.corr, envTau0, c, minR, maxR, sr, heatBins);
      prof = applyQualityAlgorithms(prof, 'balanced');
      profiles.push(prof);
      await sleep(Math.max(20, repeatGap * 0.4));
    }
    envBaseline = computeEnvBaseline(profiles, heatBins);
    envBaselinePings = profiles.length;
    console.debug(`[calib] env baseline: ${envBaselinePings} pings captured (steered at 0deg), envTau0=${(0.5 * (medTauL + medTauR) * 1000).toFixed(4)}ms`);
  }

  // Mark calibration invalid when measurements are clearly unreliable
  const maxMadMs = 1000 * Math.max(madTauL, madTauR);
  const geometryValid = geo.err < 1.0; // y² was non-negative (triangle inequality holds)
  const measurementsStable = maxMadMs < 5.0; // worst-channel MAD < 5ms
  const micPlausible = Math.abs(geo.x) < d * 3; // mic X within 3× speaker spacing
  const valid = measurementsStable && (geometryValid || micPlausible) && quality > 0.15;

  console.debug(`[calib] validity: valid=${valid} maxMAD=${maxMadMs.toFixed(3)}ms stable=${measurementsStable} geomValid=${geometryValid} micPlausible=${micPlausible} quality=${quality.toFixed(3)}>0.15=${quality > 0.15}`);

  const result: CalibrationResult = {
    valid,
    quality,
    monoLikely: mono.monoLikely,
    tauMeasured: { L: medTauL, R: medTauR },
    tauMAD: { L: madTauL, R: madTauR },
    peaks: { L: medPkL, R: medPkR },
    distances: { L: rL, R: rR },
    micPosition: { x: geo.x, y: geo.y },
    systemDelay: { common: tauSysCommon, L: tauSysL, R: tauSysR },
    geometryError: geo.err,
    envBaseline,
    envBaselinePings,
    sanity,
  };

  console.debug(`[calib] result: valid=${result.valid} quality=${result.quality.toFixed(3)} mono=${result.monoLikely} rL=${result.distances.L.toFixed(4)}m rR=${result.distances.R.toFixed(4)}m sysDelay={L:${(result.systemDelay.L * 1000).toFixed(3)}ms R:${(result.systemDelay.R * 1000).toFixed(3)}ms common:${(result.systemDelay.common * 1000).toFixed(3)}ms}`);

  store.set('calibration', result);
  store.set('status', 'ready');
  bus.emit('calibration:done', result);

  return result;
}
