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

export interface RepeatMeasurement {
  tauL: number; tauR: number; qualL: number; qualR: number;
  tdoaRatio: number; valid: boolean;
}

/**
 * Soft down-weight: remove repeats that are BOTH near the physical TDOA
 * limit AND inconsistent with the cluster's median delta.  This avoids
 * removing legitimate high-angle repeats (which would be near max TDOA
 * but consistent with each other).
 *
 * Only applies when cluster has ≥3 members.
 * Only removes if ≥2 good repeats remain.
 */
export function softFilterRepeats(
  cluster: RepeatMeasurement[],
  maxTDOA: number,
  tdoaSoftLimit = 0.80,
  deltaDevLimit = 0.40,
): RepeatMeasurement[] {
  if (cluster.length < 3 || maxTDOA <= 0) return cluster;

  const clusterDeltas = cluster.map(r => r.tauR - r.tauL);
  const clusterMedDelta = median(clusterDeltas);
  const goodRepeats = cluster.filter(r => {
    if (r.tdoaRatio <= tdoaSoftLimit) return true;
    const deltaDev = Math.abs((r.tauR - r.tauL) - clusterMedDelta) / maxTDOA;
    return deltaDev <= deltaDevLimit;
  });
  if (goodRepeats.length >= 2 && goodRepeats.length < cluster.length) {
    return goodRepeats;
  }
  return cluster;
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

/**
 * Find local maxima above 15% of the global max in the early window.
 * Returns up to `maxPeaks` candidates, combining:
 *   - Top-N by strength, and
 *   - First-M peaks in time above 20% threshold with min separation (0.25ms).
 * This ensures the direct path isn't crowded out by stronger reflections.
 */
function findCandidatePeaks(
  corr: Float32Array,
  earlyMs: number,
  sampleRate: number,
  maxPeaks = 15,
): CandidatePeak[] {
  const earlyEnd = Math.min(corr.length, Math.floor(sampleRate * (earlyMs / 1000)));
  let globalMax = 0;
  for (let i = 0; i < earlyEnd; i++) {
    const v = Math.abs(corr[i]);
    if (v > globalMax) globalMax = v;
  }
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

  // Strategy: combine earliest-in-time peaks (with min separation) + strongest peaks
  allPeaks.sort((a, b) => a.idx - b.idx);

  // First-M: earliest peaks above 20% with ≥0.25ms separation
  const earlyThresh = 0.20 * globalMax;
  const minSepSamples = Math.floor(sampleRate * 0.00025); // 0.25ms
  const earlySet: CandidatePeak[] = [];
  const earlyGuaranteed = 5;
  for (const p of allPeaks) {
    if (earlySet.length >= earlyGuaranteed) break;
    if (p.absVal < earlyThresh) continue;
    if (earlySet.length > 0 && (p.idx - earlySet[earlySet.length - 1].idx) < minSepSamples) continue;
    earlySet.push(p);
  }

  // Top-N by strength (excluding already-selected)
  const earlyIdxs = new Set(earlySet.map(p => p.idx));
  const rest = allPeaks.filter(p => !earlyIdxs.has(p.idx));
  rest.sort((a, b) => b.absVal - a.absVal);
  return [...earlySet, ...rest.slice(0, maxPeaks - earlySet.length)];
}

/**
 * Select the best (τL, τR) pair satisfying the TDOA constraint |τL − τR| ≤ maxTDOA.
 *
 * If `anchorTau` and `anchorWin` are provided, **hard-reject** any pair whose
 * mean tau is more than `anchorWin` seconds from the anchor.  This prevents
 * mode-hops: if no pair is within the window, return null (repeat is invalid).
 *
 * Tie-breaking among valid pairs (≥30 % of strongest):
 *   Primary: closeness to anchor (if provided)
 *   Secondary: earliness (prefer smaller meanTau — direct path bias)
 *   Tertiary: strength (peaks / score)
 *
 * Cross-repeat consistency is handled by the caller via clustering, not here.
 */
function selectTDOAPair(
  peaksL: CandidatePeak[],
  peaksR: CandidatePeak[],
  maxTDOA: number,
  anchorTau?: number,
  anchorWin?: number,
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
      // Hard reject pairs outside the anchor window
      if (anchorTau !== undefined && anchorWin !== undefined) {
        if (Math.abs(avgTau - anchorTau) > anchorWin) continue;
      }
      validPairs.push({
        tauL: pL.tau, tauR: pR.tau,
        peakL: pL.absVal, peakR: pR.absVal,
        idxL: pL.idx, idxR: pR.idx,
        score: pL.absVal + pR.absVal,
        avgTau,
      });
    }
  }
  if (validPairs.length === 0) return null;

  // Keep only sufficiently strong pairs (≥30% of strongest)
  const maxScore = Math.max(...validPairs.map(p => p.score));
  const strong = validPairs.filter(p => p.score >= 0.30 * maxScore);

  if (anchorTau !== undefined) {
    // Sort: primary = closeness to anchor, secondary = earliness, tertiary = score
    strong.sort((a, b) => {
      const distA = Math.abs(a.avgTau - anchorTau);
      const distB = Math.abs(b.avgTau - anchorTau);
      if (Math.abs(distA - distB) > 1e-9) return distA - distB;
      if (Math.abs(a.avgTau - b.avgTau) > 1e-9) return a.avgTau - b.avgTau;
      return b.score - a.score;
    });
  } else {
    // No anchor: prefer the earliest arrival (direct path), then strongest
    strong.sort((a, b) => {
      if (Math.abs(a.avgTau - b.avgTau) > 1e-9) return a.avgTau - b.avgTau;
      return b.score - a.score;
    });
  }

  const p = strong[0];
  return { tauL: p.tauL, tauR: p.tauR, peakL: p.peakL, peakR: p.peakR, idxL: p.idxL, idxR: p.idxR };
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

  // Max TDOA for same wavefront: d/c + 2 samples (peak quantization margin).
  // At 48 kHz, d=0.195m: 0.568ms + 0.042ms = 0.610ms.
  const maxTDOA = d / c + 2 / sr;

  // --- Pilot: multi-ping mode selection ---
  // Capture multiple L/R Golay pings, extract TDOA-gated pairs from each,
  // then cluster mean-taus to find the most repeatable *acoustic* mode.
  //
  // Two-pass clustering:
  //   Pass 1: find largest cluster among measurements with meanTau ≥ TAU_MIN_ACOUSTIC
  //           (rejects coupling / buffer artifacts that appear at sub-ms delays)
  //   Pass 2: if pass 1 found nothing, fall back to all measurements (best effort)
  //
  // TAU_MIN_ACOUSTIC: minimum plausible acoustic flight time for speaker→air→mic.
  // On a MacBook 14" the nearest driver-to-mic air path is ~6–10 cm minimum,
  // plus OS/DAC/ADC pipeline latency adds several ms.  0.6 ms ≈ 20.6 cm air
  // path — a conservative floor that rejects chassis coupling (~0.1–0.4 ms)
  // while accepting any real acoustic arrival.
  const TAU_MIN_ACOUSTIC = 0.0006; // 0.6 ms
  const PILOT_PINGS = 8;
  const pilotMeasurements: Array<{ meanTau: number; score: number }> = [];

  console.debug(`[calib] pilot: capturing ${PILOT_PINGS} L/R pings, tauMinAcoustic=${(TAU_MIN_ACOUSTIC * 1000).toFixed(1)}ms...`);
  for (let pp = 0; pp < PILOT_PINGS; pp++) {
    const pCapLA = await pingAndCaptureOneSide(a, 'L', gain, listenMs);
    await sleep(Math.max(0, gapMs));
    const pCapLB = await pingAndCaptureOneSide(b, 'L', gain, listenMs);
    const pResL = golaySumCorrelation(pCapLA.micWin, pCapLB.micWin, a, b, sr);

    await sleep(repeatGap);

    const pCapRA = await pingAndCaptureOneSide(a, 'R', gain, listenMs);
    await sleep(Math.max(0, gapMs));
    const pCapRB = await pingAndCaptureOneSide(b, 'R', gain, listenMs);
    const pResR = golaySumCorrelation(pCapRA.micWin, pCapRB.micWin, a, b, sr);

    // Collect ALL valid TDOA pairs per pilot ping (not just earliest)
    // so we can find acoustic modes even when coupling is the earliest/strongest
    const pCandsL = findCandidatePeaks(pResL.corr, earlyMs, sr);
    const pCandsR = findCandidatePeaks(pResR.corr, earlyMs, sr);

    // Gather every valid pair for this ping, not just the "best" one
    for (const cL of pCandsL) {
      for (const cR of pCandsR) {
        if (Math.abs(cL.tau - cR.tau) > maxTDOA) continue;
        const meanTau = (cL.tau + cR.tau) / 2;
        const corrQL = correlationQuality(pResL.corr, cL.idx, sr);
        const corrQR = correlationQuality(pResR.corr, cR.idx, sr);
        const score = Math.min(cL.absVal, cR.absVal) * Math.sqrt(corrQL * corrQR);
        // Only record if score is meaningful (≥30% of strongest pair so far)
        if (score > 0.01) {
          pilotMeasurements.push({ meanTau, score });
        }
      }
    }
    console.debug(`[calib] pilot #${pp + 1}: ${pCandsL.length}×${pCandsR.length} candidates, total pairs so far: ${pilotMeasurements.length}`);
    await sleep(repeatGap);
  }

  // Two-pass pilot clustering
  let pilotTau: number;
  let pilotAboveFloor = false;
  let pilotClusterMad = 0;
  const PILOT_CLUSTER_WIN = 0.0008; // 0.8ms window for pilot clustering

  function clusterPilot(measurements: typeof pilotMeasurements): { cluster: typeof pilotMeasurements; medianTau: number } | null {
    if (measurements.length === 0) return null;
    if (measurements.length === 1) return { cluster: measurements, medianTau: measurements[0].meanTau };

    let best: typeof pilotMeasurements = [];
    let bestScore = 0;
    for (const pm of measurements) {
      // Diameter constraint: all members within ±window of this seed
      const members = measurements.filter(r => Math.abs(r.meanTau - pm.meanTau) <= PILOT_CLUSTER_WIN);
      if (members.length < 2) continue;
      // Verify diameter from median center
      const mTaus = members.map(r => r.meanTau);
      const center = median(mTaus);
      const verified = members.filter(r => Math.abs(r.meanTau - center) <= PILOT_CLUSTER_WIN);
      const totalScore = verified.reduce((s, m) => s + m.score, 0);
      // Prefer: more members, then higher total score, then earlier
      if (verified.length > best.length ||
          (verified.length === best.length && totalScore > bestScore) ||
          (verified.length === best.length && Math.abs(totalScore - bestScore) < 0.001 &&
           median(verified.map(r => r.meanTau)) < median(best.map(r => r.meanTau)))) {
        best = verified;
        bestScore = totalScore;
      }
    }
    if (best.length === 0) {
      // No cluster of size ≥2, pick the measurement with highest score
      const sorted = [...measurements].sort((a, b) => b.score - a.score);
      return { cluster: [sorted[0]], medianTau: sorted[0].meanTau };
    }
    return { cluster: best, medianTau: median(best.map(r => r.meanTau)) };
  }

  if (pilotMeasurements.length === 0) {
    // Fallback: use strongest peak from a single steered Golay sum
    const fbCapA = await pingAndCaptureSteered(a, 0, gain, listenMs);
    await sleep(Math.max(0, gapMs));
    const fbCapB = await pingAndCaptureSteered(b, 0, gain, listenMs);
    const fbCorr = golaySumCorrelation(fbCapA.micWin, fbCapB.micWin, a, b, sr);
    const fbEnd = Math.min(fbCorr.corr.length, Math.floor(sr * (earlyMs / 1000)));
    const fbPk = findPeakAbs(fbCorr.corr, 0, fbEnd);
    pilotTau = fbPk.index / sr;
    console.debug(`[calib] pilot FALLBACK (no valid pairs): tau=${(pilotTau * 1000).toFixed(3)}ms`);
    await sleep(repeatGap);
  } else {
    // Pass 1: cluster only measurements above TAU_MIN_ACOUSTIC (reject coupling)
    const acoustic = pilotMeasurements.filter(m => m.meanTau >= TAU_MIN_ACOUSTIC);
    const pass1 = clusterPilot(acoustic);

    if (pass1 && pass1.cluster.length >= 2) {
      pilotTau = pass1.medianTau;
      pilotAboveFloor = true;
      const taus = pass1.cluster.map(m => m.meanTau);
      pilotClusterMad = taus.length > 1 ? mad(taus, pilotTau) : 0;
      console.debug(`[calib] pilot pass1 (acoustic): cluster=${pass1.cluster.length}/${acoustic.length} above-floor/${pilotMeasurements.length} total, tau=${(pilotTau * 1000).toFixed(3)}ms mad=${(pilotClusterMad * 1000).toFixed(3)}ms (taus: ${taus.map(t => (t * 1000).toFixed(3)).join(', ')}ms)`);
    } else {
      // Pass 2: fall back to all measurements (coupling may dominate)
      const pass2 = clusterPilot(pilotMeasurements)!;
      pilotTau = pass2.medianTau;
      const taus = pass2.cluster.map(m => m.meanTau);
      pilotClusterMad = taus.length > 1 ? mad(taus, pilotTau) : 0;
      const nAbove = acoustic.length;
      console.debug(`[calib] pilot pass2 (fallback, ${nAbove} above floor): cluster=${pass2.cluster.length}/${pilotMeasurements.length}, tau=${(pilotTau * 1000).toFixed(3)}ms mad=${(pilotClusterMad * 1000).toFixed(3)}ms (taus: ${taus.map(t => (t * 1000).toFixed(3)).join(', ')}ms)`);
      if (pilotTau < TAU_MIN_ACOUSTIC) {
        console.debug(`[calib] WARNING: pilot tau ${(pilotTau * 1000).toFixed(3)}ms < ${(TAU_MIN_ACOUSTIC * 1000).toFixed(1)}ms floor — likely coupling dominance. Consider disabling OS audio processing (AEC/NS/AGC).`);
      }
    }
  }

  // Adaptive pilot window: scale with pilot cluster spread.
  // In stable rooms, MAD is small → tighter window.
  // In reflective rooms, MAD is larger → looser window.
  // Clamped to [0.25ms, 0.5ms] for acoustic, [0.5ms, 0.8ms] for coupling fallback.
  let PILOT_WIN: number;
  if (pilotAboveFloor) {
    PILOT_WIN = clamp(2.5 * pilotClusterMad, 0.00025, 0.0005);
  } else {
    PILOT_WIN = clamp(2.5 * pilotClusterMad, 0.0005, 0.0008);
  }

  // RepeatMeasurement is now exported at module scope
  const allRepeats: RepeatMeasurement[] = [];

  console.debug(`[calib] TDOA gate: maxTDOA=${(maxTDOA * 1000).toFixed(3)}ms (d/c=${(d / c * 1000).toFixed(3)}ms + ${(2 / sr * 1000).toFixed(3)}ms margin) pilotAnchor=${(pilotTau * 1000).toFixed(3)}ms pilotWin=${(PILOT_WIN * 1000).toFixed(3)}ms`);

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

    // --- Joint peak selection with TDOA gate + hard pilot window ---
    const candsL = findCandidatePeaks(resL.corr, earlyMs, sr);
    const candsR = findCandidatePeaks(resR.corr, earlyMs, sr);
    // Hard-reject pairs beyond PILOT_WIN from pilotTau — prevents mode-hops
    const tdoaPair = selectTDOAPair(candsL, candsR, maxTDOA, pilotTau, PILOT_WIN);

    if (tdoaPair) {
      const corrQualL = correlationQuality(resL.corr, tdoaPair.idxL, sr);
      const corrQualR = correlationQuality(resR.corr, tdoaPair.idxR, sr);
      const pairDelta = Math.abs(tdoaPair.tauL - tdoaPair.tauR);
      const tdoaRatio = pairDelta / maxTDOA;

      // Guardrail: if per-repeat |δτ| > 90% of physical max, mark suspicious.
      // This can happen when one side picked a slightly different submode on a
      // distributed source.  Still keep it (pilot anchoring is the primary gate),
      // but log the warning for diagnostics.
      const suspicious = tdoaRatio > 0.90;

      allRepeats.push({ tauL: tdoaPair.tauL, tauR: tdoaPair.tauR, qualL: corrQualL, qualR: corrQualR, tdoaRatio, valid: true });
      const dist = Math.abs((tdoaPair.tauL + tdoaPair.tauR) / 2 - pilotTau) * 1000;
      console.debug(`[calib] repeat ${k + 1}/${repeats} OK: L@${(tdoaPair.tauL * 1000).toFixed(3)}ms(pk=${tdoaPair.peakL.toFixed(3)}) R@${(tdoaPair.tauR * 1000).toFixed(3)}ms(pk=${tdoaPair.peakR.toFixed(3)}) delta=${(pairDelta * 1000).toFixed(3)}ms(${(tdoaRatio * 100).toFixed(0)}%max) distFromPilot=${dist.toFixed(3)}ms corrQual=${corrQualL.toFixed(3)}/${corrQualR.toFixed(3)} candsL=${candsL.length} candsR=${candsR.length}${suspicious ? ' SUSPICIOUS(near max TDOA)' : ''}`);
    } else {
      // No valid TDOA pair within pilot window — discard this repeat
      const mL = earlyPeakFromCorrelation(resL.corr, earlyMs, sr);
      const mR = earlyPeakFromCorrelation(resR.corr, earlyMs, sr);
      allRepeats.push({ tauL: mL.tau, tauR: mR.tau, qualL: 0, qualR: 0, tdoaRatio: Infinity, valid: false });
      console.debug(`[calib] repeat ${k + 1}/${repeats} DISCARDED: no pair within pilotWin (candsL=${candsL.length} candsR=${candsR.length}), onset: L@${(mL.tau * 1000).toFixed(3)}ms R@${(mR.tau * 1000).toFixed(3)}ms delta=${(Math.abs(mL.tau - mR.tau) * 1000).toFixed(3)}ms`);
    }

    await sleep(repeatGap);
  }

  // --- Cluster valid repeats by mean-tau proximity ---
  // Finds the largest group of repeats whose mean arrival times all satisfy
  // |meanTau - clusterCenter| ≤ window (diameter constraint, not single-linkage).
  // Eliminates mode-hopping between direct path and reflections across repeats.
  const validRepeats = allRepeats.filter(r => r.valid);
  const CLUSTER_WINDOW = 0.0005; // 0.5ms radius
  let bestCluster: RepeatMeasurement[] = [];

  for (let i = 0; i < validRepeats.length; i++) {
    const seedMean = (validRepeats[i].tauL + validRepeats[i].tauR) / 2;
    const members = validRepeats.filter(r => {
      const mean = (r.tauL + r.tauR) / 2;
      return Math.abs(mean - seedMean) <= CLUSTER_WINDOW;
    });
    if (members.length < 2) {
      if (members.length > bestCluster.length) bestCluster = members;
      continue;
    }
    // Verify diameter: recompute cluster center as median, check all members fit
    const memberMeans = members.map(r => (r.tauL + r.tauR) / 2);
    const clusterCenter = median(memberMeans);
    const verified = members.filter(r => {
      const mean = (r.tauL + r.tauR) / 2;
      return Math.abs(mean - clusterCenter) <= CLUSTER_WINDOW;
    });
    if (verified.length > bestCluster.length ||
        (verified.length === bestCluster.length && verified.length > 0 &&
         median(verified.map(r => (r.tauL + r.tauR) / 2)) <
         median(bestCluster.map(r => (r.tauL + r.tauR) / 2)))) {
      bestCluster = verified;
    }
  }

  bestCluster = softFilterRepeats(bestCluster, maxTDOA);

  const clusterSize = bestCluster.length;
  const tauL = bestCluster.map(r => r.tauL);
  const tauR = bestCluster.map(r => r.tauR);
  const pkL = bestCluster.map(r => r.qualL);
  const pkR = bestCluster.map(r => r.qualR);

  const medTauL = tauL.length > 0 ? median(tauL) : 0;
  const medTauR = tauR.length > 0 ? median(tauR) : 0;
  const medPkL = pkL.length > 0 ? median(pkL) : 0;
  const medPkR = pkR.length > 0 ? median(pkR) : 0;
  const madTauL = tauL.length > 1 ? mad(tauL, medTauL) : Infinity;
  const madTauR = tauR.length > 1 ? mad(tauR, medTauR) : Infinity;

  console.debug(`[calib] clustering: ${validRepeats.length}/${repeats} valid, cluster=${clusterSize} (window=${CLUSTER_WINDOW * 1000}ms)`);
  console.debug(`[calib] all repeats: ${allRepeats.map((r, i) => `#${i + 1}${r.valid ? '' : '(disc)'} L=${(r.tauL * 1000).toFixed(3)} R=${(r.tauR * 1000).toFixed(3)}`).join(' | ')}`);
  console.debug(`[calib] statistics: medTauL=${(medTauL * 1000).toFixed(4)}ms medTauR=${(medTauR * 1000).toFixed(4)}ms madL=${(madTauL * 1000).toFixed(4)}ms madR=${(madTauR * 1000).toFixed(4)}ms`);
  console.debug(`[calib] correlation quality: medCorrQualL=${medPkL.toFixed(4)} medCorrQualR=${medPkR.toFixed(4)}`);

  // --- TDOA-based geometry ---
  // deltaTau = τR − τL is the primary geometric observable.  The common
  // system delay cancels in the difference, so deltaTau is pure acoustic
  // TDOA independent of OS/DAC/ADC pipeline latency.
  const deltaTau = medTauR - medTauL; // signed TDOA
  const deltaR = deltaTau * c;        // path difference rR − rL (meters)

  // Mic x from TDOA: for speakers at (−d/2, 0) and (+d/2, 0), with mic
  // at (x, y), the path difference rR − rL depends on x.  For y ≪ d or
  // near-field with known y, we solve exactly via the TDOA hyperboloid.
  //
  // Use preset mic y if available (typical: 0.01m for MacBooks), else
  // use a small default.  This breaks the circular dependency between
  // tauSysCommon and range estimation.
  const presetMicY = state.presetMicPosition?.y;
  const micYPrior = (presetMicY !== null && presetMicY !== undefined && Number.isFinite(presetMicY))
    ? presetMicY : 0.01; // fallback: 1cm above speaker line

  // Closed-form TDOA geometry with y prior.
  //
  // Speakers at S_L = (−d/2, 0) and S_R = (+d/2, 0), mic at (x, y).
  //   rL = sqrt((x + d/2)² + y²)
  //   rR = sqrt((x − d/2)² + y²)
  //   deltaR = rR − rL
  //
  // From rR² − rL² = −2dx and deltaR = rR − rL:
  //   sumR = rL + rR = −2dx / deltaR      [when deltaR ≠ 0]
  //   rL = (sumR − deltaR) / 2
  //
  // Then from rL² = (x + d/2)² + y²:
  //   ((−2dx/deltaR − deltaR) / 2)² = (x + d/2)² + y²
  //
  // This reduces to a quadratic in x (see derivation below).
  // When |deltaR| is very small (broadside), use x ≈ 0.
  let micX: number;
  let rL: number;
  let rR: number;

  if (Math.abs(deltaR) < 1e-6) {
    // Near-broadside: TDOA ≈ 0, mic is centered
    micX = 0;
    rL = Math.sqrt((d / 2) * (d / 2) + micYPrior * micYPrior);
    rR = rL;
  } else {
    // From the constraint equations, substituting sumR = -2dx/deltaR:
    //   rL = (-2dx/deltaR - deltaR) / 2 = -(dx/deltaR + deltaR/2)
    //   rL² = (x + d/2)² + y²
    //
    // Let A = d/deltaR. Then rL = -(Ax + deltaR/2).
    // Squaring: A²x² + A·deltaR·x + deltaR²/4 = x² + dx + d²/4 + y²
    //   (A² − 1)x² + (A·deltaR − d)x + (deltaR²/4 − d²/4 − y²) = 0
    const A = d / deltaR;
    const qa = A * A - 1;
    const qb = A * deltaR - d;
    const qc = (deltaR * deltaR - d * d) / 4 - micYPrior * micYPrior;

    if (Math.abs(qa) < 1e-12) {
      // Linear case (deltaR ≈ ±d): x = -qc/qb
      micX = qb !== 0 ? -qc / qb : 0;
    } else {
      const disc = qb * qb - 4 * qa * qc;
      if (disc < 0) {
        // No real solution (y prior too large for this TDOA) — use linear approx
        micX = -deltaR / 2;
      } else {
        const sqrtDisc = Math.sqrt(disc);
        const x1 = (-qb + sqrtDisc) / (2 * qa);
        const x2 = (-qb - sqrtDisc) / (2 * qa);
        // Pick solution where rL > 0: rL = -(A*x + deltaR/2)
        const rL1 = -(A * x1 + deltaR / 2);
        const rL2 = -(A * x2 + deltaR / 2);
        if (rL1 > 0 && rL2 > 0) {
          // Both valid — prefer the one closer to center (more likely for a mic)
          micX = Math.abs(x1) <= Math.abs(x2) ? x1 : x2;
        } else if (rL1 > 0) {
          micX = x1;
        } else if (rL2 > 0) {
          micX = x2;
        } else {
          micX = -deltaR / 2; // fallback
        }
      }
    }
    rL = Math.sqrt((micX + d / 2) * (micX + d / 2) + micYPrior * micYPrior);
    rR = Math.sqrt((micX - d / 2) * (micX - d / 2) + micYPrior * micYPrior);
  }

  // System delay: meanTau minus mean range / c
  const meanTau = (medTauL + medTauR) / 2;
  const meanRange = (rL + rR) / 2;
  const tauSysCommon = Math.max(0, meanTau - meanRange / c);

  // Legacy range-based geometry (for y estimation and backwards compat)
  const geo = estimateMicXY(rL, rR, d);

  const tauSysL = Math.max(0, medTauL - (rL / c));
  const tauSysR = Math.max(0, medTauR - (rR / c));

  // --- Honest geometry quality metric ---
  // The TDOA solver produces err≈0 by construction (it fits the exact
  // constraint it was solved from).  Instead, measure per-repeat delta
  // consistency: how well individual repeat deltas agree with the median.
  // This captures submode instability across repeats.
  const perRepeatDeltas = bestCluster.map(r => r.tauR - r.tauL);
  const medDelta = perRepeatDeltas.length > 0 ? median(perRepeatDeltas) : 0;
  const madDelta = perRepeatDeltas.length > 1 ? mad(perRepeatDeltas, medDelta) : Infinity;
  // Normalize: MAD(delta) / maxTDOA.  A value of 0 = perfect agreement,
  // 1.0 = delta spread equals the physical max TDOA.
  const deltaConsistency = Number.isFinite(madDelta) ? madDelta / maxTDOA : 1.0;
  // Max deviation: worst single-repeat outlier (diagnostic, not used for gating).
  // Catches "one repeat picked a different submode" even when MAD stays modest.
  const maxDeltaDev = perRepeatDeltas.length > 0
    ? Math.max(...perRepeatDeltas.map(d => Math.abs(d - medDelta))) / maxTDOA : 0;

  console.debug(`[calib] TDOA: deltaTau=${(deltaTau * 1000).toFixed(4)}ms deltaR=${(deltaR * 100).toFixed(2)}cm`);
  console.debug(`[calib] TDOA geometry: micX=${micX.toFixed(4)}m micYPrior=${micYPrior.toFixed(4)}m`);
  console.debug(`[calib] distances: rL=${rL.toFixed(4)}m rR=${rR.toFixed(4)}m tauSysCommon=${(tauSysCommon * 1000).toFixed(4)}ms`);
  console.debug(`[calib] system delays: L=${(tauSysL * 1000).toFixed(4)}ms R=${(tauSysR * 1000).toFixed(4)}ms delta=${((tauSysL - tauSysR) * 1000).toFixed(4)}ms`);
  console.debug(`[calib] geometry: mic=(${micX.toFixed(4)}, ${(geo.y > 0 ? geo.y : micYPrior).toFixed(4)}) deltaConsistency=${deltaConsistency.toFixed(4)} maxDeltaDev=${maxDeltaDev.toFixed(4)} spacing=${d.toFixed(3)}m`);

  const mono = assessMonoDecision(medTauL, medTauR, medPkL, medPkR, d, c);
  console.debug(`[calib] mono assessment: monoLikely=${mono.monoLikely} dt=${(mono.dt * 1000).toFixed(4)}ms dp=${mono.dp.toFixed(4)} monoByTime=${mono.monoByTime} monoByPeak=${mono.monoByPeak}`);

  const quality = computeCalibQuality({
    tauMadL: madTauL, tauMadR: madTauR,
    peakL: medPkL, peakR: medPkR,
    geomErr: deltaConsistency, monoLikely: mono.monoLikely,
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

  // Use TDOA-gated peak selection for sanity check, anchored to calibration median
  // Sanity uses wider window (1ms) since it's a single measurement
  const sanityAnchor = (medTauL + medTauR) / 2;
  const sanityCandL = findCandidatePeaks(resLSanity.corr, earlyMs, sr);
  const sanityCandR = findCandidatePeaks(resRSanity.corr, earlyMs, sr);
  const sanityPair = selectTDOAPair(sanityCandL, sanityCandR, maxTDOA, sanityAnchor, 0.001);

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

  // Mark calibration invalid when measurements are clearly unreliable.
  // Primary gates: signal-quality checks (stability, cluster size, corrQual,
  // delta consistency).  Geometry fit is advisory — on distributed sources
  // (laptop speakers) the point-source model is inherently violated.
  const maxMadMs = Number.isFinite(madTauL) && Number.isFinite(madTauR)
    ? 1000 * Math.max(madTauL, madTauR) : Infinity;
  const measurementsStable = maxMadMs < 2.0; // worst-channel MAD < 2ms
  const deltaConsistent = deltaConsistency < 0.3; // per-repeat deltas agree within 30% of maxTDOA
  const micPlausible = Math.abs(micX) < d * 3; // mic X within 3× speaker spacing
  const enoughRepeats = clusterSize >= 2; // need ≥2 consistent repeats
  const corrQualOk = medPkL > 0.15 && medPkR > 0.15; // correlation quality above noise floor

  // Accept if: enough consistent repeats + stable + consistent deltas +
  // decent corrQual + plausible mic position + quality above floor
  const valid = enoughRepeats && measurementsStable && corrQualOk
    && deltaConsistent && micPlausible && quality > 0.15;

  // Confidence tier: angle information is reliable when per-repeat TDOA
  // deltas are well-agreed.  maxDeltaDev < 0.6 means worst repeat's delta
  // deviates by less than 60% of maxTDOA from the median — good enough
  // for steering.  When false, calibration is still usable for range/timing.
  const angleReliable = valid && maxDeltaDev < 0.6;

  console.debug(`[calib] validity: valid=${valid} cluster=${clusterSize}≥2=${enoughRepeats} maxMAD=${maxMadMs.toFixed(3)}ms stable=${measurementsStable} deltaConsist=${deltaConsistency.toFixed(3)}<0.3=${deltaConsistent} micPlausible=${micPlausible} corrQualOk=${corrQualOk} quality=${quality.toFixed(3)}>0.15=${quality > 0.15} angleReliable=${angleReliable}(maxDeltaDev=${maxDeltaDev.toFixed(3)}<0.6)`);

  const result: CalibrationResult = {
    valid,
    quality,
    angleReliable,
    monoLikely: mono.monoLikely,
    tauMeasured: { L: medTauL, R: medTauR },
    tauMAD: { L: madTauL, R: madTauR },
    peaks: { L: medPkL, R: medPkR },
    distances: { L: rL, R: rR },
    micPosition: { x: micX, y: geo.y > 0 ? geo.y : micYPrior },
    systemDelay: { common: tauSysCommon, L: tauSysL, R: tauSysR },
    geometryError: deltaConsistency,
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
