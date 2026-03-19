import { store } from '../core/store.js';
import { bus } from '../core/event-bus.js';
import { sleep, median, mad, signalEnergy, energyNormalize } from '../utils.js';
import { clamp } from '../utils.js';
import { fftCorrelate } from '../dsp/fft-correlate.js';
import { measureRoundTripLatency } from '../audio/latency.js';
import { findPeakAbs, estimateBestFromProfile } from '../dsp/peak.js';
import { buildRangeProfileFromCorrelation } from '../dsp/profile.js';
import { applyQualityAlgorithms } from '../dsp/quality.js';
import { caCfar, cfarAlpha } from '../dsp/cfar.js';
import { computeProfileConfidence } from '../scan/confidence.js';
import {
  createNoiseKalmanState,
  guardBackoff,
  subtractNoiseFloor,
  updateNoiseKalman,
} from '../dsp/noise-floor-kalman.js';
import { genGolayChipped } from '../signal/golay.js';
import { pingAndCaptureOneSide, pingAndCaptureSteered } from '../spatial/steering.js';
import { computeListenSamples, getRingBuffer, getSampleRate } from '../audio/engine.js';
import { assessMonoDecision } from './mono-detect.js';
import { computeCalibQuality } from './quality-score.js';
import { computeEnvBaseline } from './env-baseline.js';
import { estimateMicXY } from '../spatial/geometry.js';
import { runBandCalibration, type RawPingCapture } from './band-runner.js';
import { fuseBandResults, getSelectedBandResult } from './band-fusion.js';
import { qualifyMultiplexCarriers } from './multiplex-carrier-selection.js';
import { DEFAULT_MULTIPLEX, MULTIBAND_BANDS } from '../constants.js';
import { peerManager } from '../network/peer-manager.js';
import type {
  CalibrationResult,
  CalibrationSanity,
  GolayConfig,
  MicArrayCalibration,
  MicChannelCalibration,
  MultibandInfo,
  MultiplexConfig,
} from '../types.js';

let calibrationAborted = false;

export function abortCalibration(): void {
  calibrationAborted = true;
}

function checkCalibrationAborted(): void {
  if (calibrationAborted) {
    calibrationAborted = false;
    store.set('status', 'ready');
    throw new Error('Calibration aborted by user');
  }
}

interface GolaySumResult {
  corr: Float32Array;
  rawPeak: number;
}

export interface RepeatMeasurement {
  tauL: number; tauR: number; qualL: number; qualR: number;
  tdoaRatio: number; valid: boolean;
}

interface SolvedMicGeometry {
  micX: number;
  rL: number;
  rR: number;
}

interface AdaptiveThresholdComputationInput {
  profiles: Float32Array[];
  minR: number;
  maxR: number;
  strengthGate: number;
  confidenceGate: number;
  cfar: {
    guardCells: number;
    trainingCells: number;
    pfa: number;
    minThreshold: number;
  };
}

function percentileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const qq = clamp(q, 0, 1);
  const pos = qq * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const t = pos - lo;
  return sorted[lo] * (1 - t) + sorted[hi] * t;
}

export function deriveAdaptiveDetectionThresholds(
  input: AdaptiveThresholdComputationInput,
): CalibrationResult['adaptiveDetection'] | undefined {
  if (input.profiles.length < 2) return undefined;

  const bestVals: number[] = [];
  const confidences: number[] = [];
  const cfarRatios: number[] = [];

  for (const profile of input.profiles) {
    if (profile.length === 0) continue;
    const best = estimateBestFromProfile(profile, input.minR, input.maxR);
    if (!(best.bin >= 0) || !(best.val > 0)) continue;

    const conf = computeProfileConfidence(profile, best.bin, best.val).confidence;
    const cfar = caCfar(profile, input.cfar);
    const threshold = best.bin < cfar.thresholds.length ? cfar.thresholds[best.bin] : NaN;
    const ratio = Number.isFinite(threshold) && threshold > 0
      ? best.val / threshold
      : NaN;

    bestVals.push(best.val);
    confidences.push(conf);
    if (Number.isFinite(ratio) && ratio > 0) cfarRatios.push(ratio);
  }

  const sampleCount = bestVals.length;
  if (sampleCount < 2) return undefined;

  const bestSorted = [...bestVals].sort((a, b) => a - b);
  const confSorted = [...confidences].sort((a, b) => a - b);
  const ratioSorted = [...cfarRatios].sort((a, b) => a - b);

  const bestP25 = percentileSorted(bestSorted, 0.25);
  const confP25 = percentileSorted(confSorted, 0.25);
  const ratioMed = ratioSorted.length > 0 ? percentileSorted(ratioSorted, 0.5) : NaN;

  const weakEnvironment =
    (Number.isFinite(ratioMed) && ratioMed < 1.25)
    || confP25 < input.confidenceGate * 0.8;

  const strengthCap = weakEnvironment ? input.strengthGate * 0.82 : input.strengthGate;
  const strengthGate = clamp(
    Math.min(strengthCap, Math.max(2e-5, bestP25 * 0.86)),
    2e-5,
    0.5,
  );
  const confidenceScale = weakEnvironment ? 0.75 : 0.90;
  const confidenceFloor = weakEnvironment ? 0.05 : 0.06;
  const confidenceGate = clamp(
    Math.min(input.confidenceGate, Math.max(confidenceFloor, confP25 * confidenceScale)),
    confidenceFloor,
    0.95,
  );

  let cfarPfa = input.cfar.pfa;
  if (Number.isFinite(ratioMed) && ratioMed > 0) {
    const trainCount = Math.max(2, 2 * Math.max(1, input.cfar.trainingCells));
    const alphaCurrent = cfarAlpha(trainCount, input.cfar.pfa);
    const targetRatio = 1.05;
    if (alphaCurrent > 0 && ratioMed < targetRatio) {
      const alphaScale = clamp(ratioMed / targetRatio, 0.22, 1);
      const alphaNew = Math.max(0.05, alphaCurrent * alphaScale);
      const pfaFromAlpha = Math.pow(1 + alphaNew / trainCount, -trainCount);
      cfarPfa = clamp(Math.max(input.cfar.pfa, pfaFromAlpha), input.cfar.pfa, 0.2);
    }
  }

  return {
    strengthGate,
    confidenceGate,
    cfarPfa,
    sampleCount,
    source: 'calibration-env',
  };
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

function solveMicGeometryFromDeltaR(
  deltaR: number,
  d: number,
  micYPrior: number,
): SolvedMicGeometry {
  if (Math.abs(deltaR) < 1e-6) {
    const r = Math.sqrt((d / 2) * (d / 2) + micYPrior * micYPrior);
    return { micX: 0, rL: r, rR: r };
  }

  const A = d / deltaR;
  const qa = A * A - 1;
  const qb = A * deltaR - d;
  const qc = (deltaR * deltaR - d * d) / 4 - micYPrior * micYPrior;

  let micX: number;
  if (Math.abs(qa) < 1e-12) {
    micX = qb !== 0 ? -qc / qb : 0;
  } else {
    const disc = qb * qb - 4 * qa * qc;
    if (disc < 0) {
      micX = -deltaR / 2;
    } else {
      const sqrtDisc = Math.sqrt(disc);
      const x1 = (-qb + sqrtDisc) / (2 * qa);
      const x2 = (-qb - sqrtDisc) / (2 * qa);
      const rL1 = -(A * x1 + deltaR / 2);
      const rL2 = -(A * x2 + deltaR / 2);
      if (rL1 > 0 && rL2 > 0) {
        micX = Math.abs(x1) <= Math.abs(x2) ? x1 : x2;
      } else if (rL1 > 0) {
        micX = x1;
      } else if (rL2 > 0) {
        micX = x2;
      } else {
        micX = -deltaR / 2;
      }
    }
  }

  const rL = Math.sqrt((micX + d / 2) * (micX + d / 2) + micYPrior * micYPrior);
  const rR = Math.sqrt((micX - d / 2) * (micX - d / 2) + micYPrior * micYPrior);
  return { micX, rL, rR };
}

function clusterRepeatMeasurements(
  repeats: RepeatMeasurement[],
  clusterWindow: number,
): RepeatMeasurement[] {
  const validRepeats = repeats.filter(r => r.valid);
  if (validRepeats.length === 0) return [];

  let bestCluster: RepeatMeasurement[] = [];
  for (let i = 0; i < validRepeats.length; i++) {
    const seedMean = (validRepeats[i].tauL + validRepeats[i].tauR) / 2;
    const members = validRepeats.filter(r => {
      const mean = (r.tauL + r.tauR) / 2;
      return Math.abs(mean - seedMean) <= clusterWindow;
    });
    if (members.length < 2) {
      if (members.length > bestCluster.length) bestCluster = members;
      continue;
    }

    const memberMeans = members.map(r => (r.tauL + r.tauR) / 2);
    const clusterCenter = median(memberMeans);
    const verified = members.filter(r => {
      const mean = (r.tauL + r.tauR) / 2;
      return Math.abs(mean - clusterCenter) <= clusterWindow;
    });

    if (verified.length > bestCluster.length ||
        (verified.length === bestCluster.length && verified.length > 0 &&
         median(verified.map(r => (r.tauL + r.tauR) / 2)) <
         median(bestCluster.map(r => (r.tauL + r.tauR) / 2)))) {
      bestCluster = verified;
    }
  }

  return bestCluster;
}

export interface BuildMicArrayCalibrationParams {
  repeatsByChannel: RepeatMeasurement[][];
  clusterWindow: number;
  maxTDOA: number;
  d: number;
  c: number;
  micYPrior: number;
  fallbackTauMeasured: { L: number; R: number };
  previous?: MicArrayCalibration;
  nowMs?: number;
}

export function buildMicArrayCalibrationFromRepeats(params: BuildMicArrayCalibrationParams): MicArrayCalibration | undefined {
  const {
    repeatsByChannel,
    clusterWindow,
    maxTDOA,
    d,
    c,
    micYPrior,
    fallbackTauMeasured,
    previous,
    nowMs,
  } = params;

  if (repeatsByChannel.length <= 1) return undefined;

  const channelCalibrations: MicChannelCalibration[] = [];

  for (let ch = 0; ch < repeatsByChannel.length; ch++) {
    const repeatsForChannel = repeatsByChannel[ch] ?? [];
    let chCluster = clusterRepeatMeasurements(repeatsForChannel, clusterWindow);
    chCluster = softFilterRepeats(chCluster, maxTDOA);

    const chTauL = chCluster.map(r => r.tauL);
    const chTauR = chCluster.map(r => r.tauR);
    const chPkL = chCluster.map(r => r.qualL);
    const chPkR = chCluster.map(r => r.qualR);
    const chMedTauL = chTauL.length > 0 ? median(chTauL) : fallbackTauMeasured.L;
    const chMedTauR = chTauR.length > 0 ? median(chTauR) : fallbackTauMeasured.R;
    const chMedPkL = chPkL.length > 0 ? median(chPkL) : 0;
    const chMedPkR = chPkR.length > 0 ? median(chPkR) : 0;
    const chMadTauL = chTauL.length > 1 ? mad(chTauL, chMedTauL) : Infinity;
    const chMadTauR = chTauR.length > 1 ? mad(chTauR, chMedTauR) : Infinity;

    const chPerRepeatDeltas = chCluster.map(r => r.tauR - r.tauL);
    const chMedDelta = chPerRepeatDeltas.length > 0 ? median(chPerRepeatDeltas) : 0;
    const chMadDelta = chPerRepeatDeltas.length > 1 ? mad(chPerRepeatDeltas, chMedDelta) : Infinity;
    const chDeltaConsistency = Number.isFinite(chMadDelta) ? chMadDelta / maxTDOA : 1.0;

    const chDeltaTau = chMedTauR - chMedTauL;
    const chDeltaR = chDeltaTau * c;
    const chSolvedMic = solveMicGeometryFromDeltaR(chDeltaR, d, micYPrior);
    const chMeanTau = (chMedTauL + chMedTauR) / 2;
    const chMeanRange = (chSolvedMic.rL + chSolvedMic.rR) / 2;
    const chSysCommon = Math.max(0, chMeanTau - chMeanRange / c);
    const chSysL = Math.max(0, chMedTauL - chSolvedMic.rL / c);
    const chSysR = Math.max(0, chMedTauR - chSolvedMic.rR / c);

    const chQuality = computeCalibQuality({
      tauMadL: chMadTauL,
      tauMadR: chMadTauR,
      peakL: chMedPkL,
      peakR: chMedPkR,
      geomErr: chDeltaConsistency,
      monoLikely: false,
    });

    const chMaxMadMs = Number.isFinite(chMadTauL) && Number.isFinite(chMadTauR)
      ? 1000 * Math.max(chMadTauL, chMadTauR) : Infinity;
    const chStable = chMaxMadMs < 2.0;
    const chMicPlausible = Math.abs(chSolvedMic.micX) < d * 3;

    const chValid =
      chCluster.length >= 2 &&
      chMedPkL > 0.12 &&
      chMedPkR > 0.12 &&
      chStable &&
      chMicPlausible &&
      chQuality > 0.12;

    channelCalibrations.push({
      channelIndex: ch,
      valid: chValid,
      quality: chQuality,
      tauMeasured: { L: chMedTauL, R: chMedTauR },
      tauMAD: { L: chMadTauL, R: chMadTauR },
      distances: { L: chSolvedMic.rL, R: chSolvedMic.rR },
      micPosition: { x: chSolvedMic.micX, y: micYPrior },
      systemDelay: { common: chSysCommon, L: chSysL, R: chSysR },
      relativeDelaySec: 0,
      repeatClusterSize: chCluster.length,
      geometryError: chDeltaConsistency,
    });
  }

  if (channelCalibrations.length === 0) return undefined;

  const refChannel =
    channelCalibrations.find(ch => ch.channelIndex === 0 && ch.valid)
    ?? channelCalibrations.find(ch => ch.valid)
    ?? channelCalibrations[0];

  for (const ch of channelCalibrations) {
    ch.relativeDelaySec = ch.systemDelay.common - refChannel.systemDelay.common;
  }

  const timestampMs = nowMs ?? Date.now();
  if (previous && previous.channels.length === channelCalibrations.length) {
    let maxMicShiftM = 0;
    let maxDelayShiftMs = 0;
    for (const ch of channelCalibrations) {
      const prev = previous.channels.find(p => p.channelIndex === ch.channelIndex);
      if (!prev) continue;
      const dx = ch.micPosition.x - prev.micPosition.x;
      const dy = ch.micPosition.y - prev.micPosition.y;
      maxMicShiftM = Math.max(maxMicShiftM, Math.sqrt(dx * dx + dy * dy));
      maxDelayShiftMs = Math.max(maxDelayShiftMs, Math.abs(ch.relativeDelaySec - prev.relativeDelaySec) * 1000);
    }

    const suspiciousDrift = maxMicShiftM > 0.08 || maxDelayShiftMs > 0.35;
    const prevValidCount = previous.channels.filter(ch => ch.valid).length;
    const nextValidCount = channelCalibrations.filter(ch => ch.valid).length;

    if (suspiciousDrift && prevValidCount >= nextValidCount) {
      return {
        channels: previous.channels.map(ch => ({
          ...ch,
          tauMeasured: { ...ch.tauMeasured },
          tauMAD: { ...ch.tauMAD },
          distances: { ...ch.distances },
          micPosition: { ...ch.micPosition },
          systemDelay: { ...ch.systemDelay },
        })),
        generatedAtMs: timestampMs,
        driftFromPrevious: {
          maxMicShiftM,
          maxDelayShiftMs,
          resetApplied: true,
        },
      };
    }

    return {
      channels: channelCalibrations,
      generatedAtMs: timestampMs,
      driftFromPrevious: {
        maxMicShiftM,
        maxDelayShiftMs,
        resetApplied: false,
      },
    };
  }

  return {
    channels: channelCalibrations,
    generatedAtMs: timestampMs,
  };
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

  // Energy normalization consistent with the ping-cycle pipeline.
  // absMaxNormalize made noise indistinguishable from echoes (peak always 1.0).
  const totalEnergy = signalEnergy(a) + signalEnergy(b);
  energyNormalize(sum, totalEnergy);
  return { corr: sum, rawPeak };
}

async function captureAmbientWindow(
  listenMs: number,
  refLength: number,
  sampleRate: number,
): Promise<Float32Array | null> {
  const ring = getRingBuffer();
  if (!ring) return null;
  const waitMs = Math.max(60, listenMs * 0.75);
  await sleep(waitMs);
  const end = ring.position;
  const listenSamples = computeListenSamples(listenMs, refLength, sampleRate);
  return ring.read(end, listenSamples);
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

export function shouldUseMultibandOverride(
  wideband: { valid: boolean; quality: number },
  selected: { valid: boolean; quality: number } | null | undefined,
): boolean {
  if (!selected || !selected.valid) return false;
  if (!wideband.valid) return true;
  return selected.quality > wideband.quality;
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

  if (config.distributed.enabled && peerManager.getPeerCount() > 0) {
    console.debug('[calib] peers connected: calibration runs local-only on this device (remote captures are ignored).');
  }

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

  // Store raw captures for multiband processing
  const rawPilotCaptures: RawPingCapture[] = [];
  const rawRepeatCaptures: RawPingCapture[] = [];

  calibrationAborted = false;

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

    // Save raw captures for multiband
    rawPilotCaptures.push({
      micLA: pCapLA.micWin, micLB: pCapLB.micWin,
      micRA: pCapRA.micWin, micRB: pCapRB.micWin,
    });

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

  checkCalibrationAborted();

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
  const perChannelRepeats: RepeatMeasurement[][] = [];
  const repeatRawPeaks: number[] = [];

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
    repeatRawPeaks.push(Math.max(resL.rawPeak, resR.rawPeak));

    const channelCount = Math.min(
      capLA.micChannels.length,
      capLB.micChannels.length,
      capRA.micChannels.length,
      capRB.micChannels.length,
    );
    for (let ch = 0; ch < channelCount; ch++) {
      if (!perChannelRepeats[ch]) perChannelRepeats[ch] = [];
      const chResL = golaySumCorrelation(capLA.micChannels[ch], capLB.micChannels[ch], a, b, sr);
      const chResR = golaySumCorrelation(capRA.micChannels[ch], capRB.micChannels[ch], a, b, sr);
      const chCandsL = findCandidatePeaks(chResL.corr, earlyMs, sr);
      const chCandsR = findCandidatePeaks(chResR.corr, earlyMs, sr);
      const chPair = selectTDOAPair(chCandsL, chCandsR, maxTDOA, pilotTau, PILOT_WIN);

      if (chPair) {
        const corrQualL = correlationQuality(chResL.corr, chPair.idxL, sr);
        const corrQualR = correlationQuality(chResR.corr, chPair.idxR, sr);
        const pairDelta = Math.abs(chPair.tauL - chPair.tauR);
        const tdoaRatio = pairDelta / maxTDOA;
        perChannelRepeats[ch].push({
          tauL: chPair.tauL,
          tauR: chPair.tauR,
          qualL: corrQualL,
          qualR: corrQualR,
          tdoaRatio,
          valid: true,
        });
      } else {
        const chPeakL = earlyPeakFromCorrelation(chResL.corr, earlyMs, sr);
        const chPeakR = earlyPeakFromCorrelation(chResR.corr, earlyMs, sr);
        perChannelRepeats[ch].push({
          tauL: chPeakL.tau,
          tauR: chPeakR.tau,
          qualL: 0,
          qualR: 0,
          tdoaRatio: Infinity,
          valid: false,
        });
      }
    }

    // Save raw captures for multiband
    rawRepeatCaptures.push({
      micLA: capLA.micWin, micLB: capLB.micWin,
      micRA: capRA.micWin, micRB: capRB.micWin,
    });

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

  checkCalibrationAborted();

  // --- Cluster valid repeats by mean-tau proximity ---
  // Finds the largest group of repeats whose mean arrival times all satisfy
  // |meanTau - clusterCenter| ≤ window (diameter constraint, not single-linkage).
  // Eliminates mode-hopping between direct path and reflections across repeats.
  const CLUSTER_WINDOW = 0.0005; // 0.5ms radius
  const validRepeats = allRepeats.filter(r => r.valid);
  let bestCluster = clusterRepeatMeasurements(allRepeats, CLUSTER_WINDOW);

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

  const solvedMic = solveMicGeometryFromDeltaR(deltaR, d, micYPrior);
  const micX = solvedMic.micX;
  const rL = solvedMic.rL;
  const rR = solvedMic.rR;

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

  checkCalibrationAborted();

  // Env baseline
  let envBaselineRaw: Float32Array | null = null;
  let envBaselineFiltered: Float32Array | null = null;
  let envBaseline: Float32Array | null = null;
  let envBaselinePings = 0;
  let ambientNoisePings = 0;
  let ambientNoiseRawPeakMedian = NaN;
  let ambientNoiseRawPeakMad = NaN;
  let txContrast = Infinity;
  const adaptiveProfiles: Float32Array[] = [];
  if (extraCalPings > 0 && Number.isFinite(minR) && Number.isFinite(maxR) && maxR > minR) {
    const profiles: Float32Array[] = [];
    const filteredProfiles: Float32Array[] = [];
    const useNoiseKalmanInCalibration = config.noiseKalman.enabled && config.noiseKalman.useInCalibration;
    let noiseKalmanState = useNoiseKalmanInCalibration
      ? createNoiseKalmanState(heatBins, config.noiseKalman.minFloor)
      : null;
    const envRawPeaks: number[] = [];

    for (let i = 0; i < extraCalPings; i++) {
      // Capture at theta=0 using steered stereo Golay (both speakers active)
      const cA = await pingAndCaptureSteered(a, 0, gain, listenMs);
      await sleep(Math.max(0, gapMs));
      const cB = await pingAndCaptureSteered(b, 0, gain, listenMs);
      const envRes = golaySumCorrelation(cA.micWin, cB.micWin, a, b, sr);
      envRawPeaks.push(envRes.rawPeak);
      const envTau0 = 0.5 * (medTauL + medTauR);
      let prof = buildRangeProfileFromCorrelation(envRes.corr, envTau0, c, minR, maxR, sr, heatBins);
      prof = applyQualityAlgorithms(prof, 'balanced');
      profiles.push(prof);
      adaptiveProfiles.push(prof);

      if (noiseKalmanState && noiseKalmanState.x.length === prof.length) {
        updateNoiseKalman(noiseKalmanState, prof, {
          q: config.noiseKalman.processNoiseQ,
          r: config.noiseKalman.measurementNoiseR,
          minFloor: config.noiseKalman.minFloor,
          maxFloor: config.noiseKalman.maxFloor,
        });
        const kalmanSubtracted = subtractNoiseFloor(
          prof,
          noiseKalmanState,
          config.noiseKalman.subtractStrength,
          config.noiseKalman.minFloor,
          config.noiseKalman.maxFloor,
        );
        filteredProfiles.push(guardBackoff(prof, kalmanSubtracted, config.subtractionBackoff).profile);
      }

      await sleep(Math.max(20, repeatGap * 0.4));
    }
    envBaselineRaw = computeEnvBaseline(profiles, heatBins);
    envBaselineFiltered = filteredProfiles.length > 0 ? computeEnvBaseline(filteredProfiles, heatBins) : null;
    envBaseline = envBaselineFiltered ?? envBaselineRaw;
    envBaselinePings = profiles.length;

    const ambientCaptureCount = Math.max(2, Math.min(5, Math.floor(extraCalPings * 0.5)));
    const ambientRawPeaks: number[] = [];
    for (let i = 0; i < ambientCaptureCount; i++) {
      const ambientA = await captureAmbientWindow(listenMs, a.length, sr);
      await sleep(Math.max(0, gapMs));
      const ambientB = await captureAmbientWindow(listenMs, b.length, sr);
      if (!ambientA || !ambientB) break;
      const ambientRes = golaySumCorrelation(ambientA, ambientB, a, b, sr);
      ambientRawPeaks.push(ambientRes.rawPeak);
      await sleep(Math.max(20, repeatGap * 0.3));
    }

    ambientNoisePings = ambientRawPeaks.length;
    if (ambientRawPeaks.length > 0) {
      const ambientMed = median(ambientRawPeaks);
      const ambientSpread = ambientRawPeaks.length > 1 ? mad(ambientRawPeaks, ambientMed) : 0;
      ambientNoiseRawPeakMedian = ambientMed;
      ambientNoiseRawPeakMad = ambientSpread;

      const envMed = envRawPeaks.length > 0 ? median(envRawPeaks) : (repeatRawPeaks.length > 0 ? median(repeatRawPeaks) : NaN);
      if (Number.isFinite(envMed) && envMed > 1e-12) {
        txContrast = envMed / Math.max(1e-12, ambientMed);
      }
    }

    console.debug(`[calib] env baseline: ${envBaselinePings} pings captured (steered at 0deg), filtered=${envBaselineFiltered ? 'yes' : 'no'}, envTau0=${(0.5 * (medTauL + medTauR) * 1000).toFixed(4)}ms`);
    if (ambientNoisePings > 0) {
      console.debug(`[calib] ambient noise: pings=${ambientNoisePings} rawPeakMed=${ambientNoiseRawPeakMedian.toExponential(3)} rawPeakMAD=${ambientNoiseRawPeakMad.toExponential(3)} txContrast=${Number.isFinite(txContrast) ? txContrast.toFixed(2) : 'n/a'}`);
    }
  }

  checkCalibrationAborted();

  // Mark calibration invalid only when timing measurements are clearly unreliable.
  // Geometry/TDOA consistency is evaluated separately via angleReliable, because
  // distributed sources and screen reflections can violate point-source assumptions
  // while still yielding usable timing/range calibration.
  const maxMadMs = Number.isFinite(madTauL) && Number.isFinite(madTauR)
    ? 1000 * Math.max(madTauL, madTauR) : Infinity;
  const measurementsStable = maxMadMs < 2.0; // worst-channel MAD < 2ms
  const deltaConsistent = deltaConsistency < 0.3; // per-repeat deltas agree within 30% of maxTDOA
  const micPlausible = Math.abs(micX) < d * 3; // mic X within 3× speaker spacing
  const enoughRepeats = clusterSize >= 2; // need ≥2 consistent repeats
  const corrQualOk = medPkL > 0.15 && medPkR > 0.15; // correlation quality above noise floor
  const txContrastOk = !Number.isFinite(txContrast) || txContrast >= 1.35;

  // Timing/range validity (used by predictedTau0 and delay compensation).
  const timingValid = enoughRepeats && measurementsStable && corrQualOk
    && micPlausible && quality > 0.15 && txContrastOk;
  const valid = timingValid;

  // Confidence tier: angle information is reliable when per-repeat TDOA
  // deltas are well-agreed.  maxDeltaDev < 0.6 means worst repeat's delta
  // deviates by less than 60% of maxTDOA from the median — good enough
  // for steering.  When false, calibration is still usable for range/timing.
  const angleReliable = timingValid && deltaConsistent && maxDeltaDev < 0.6;

  console.debug(`[calib] validity: valid=${valid} timingValid=${timingValid} cluster=${clusterSize}≥2=${enoughRepeats} maxMAD=${maxMadMs.toFixed(3)}ms stable=${measurementsStable} deltaConsist=${deltaConsistency.toFixed(3)}<0.3=${deltaConsistent} micPlausible=${micPlausible} corrQualOk=${corrQualOk} quality=${quality.toFixed(3)}>0.15=${quality > 0.15} txContrastOk=${txContrastOk}(${Number.isFinite(txContrast) ? txContrast.toFixed(2) : 'n/a'}≥1.35) angleReliable=${angleReliable}(maxDeltaDev=${maxDeltaDev.toFixed(3)}<0.6)`);

  // --- Multiband analysis ---
  // Run per-band calibration on the saved raw captures, then fuse.
  // This uses the same mic captures but filtered into frequency bands.
  // Multiband overrides (populated if multiband produces better results)
  let multibandInfo: MultibandInfo | undefined;
  let mbValid = valid;
  let mbQuality = quality;
  let mbAngleReliable = angleReliable;
  let mbMonoLikely = mono.monoLikely;
  let mbTauMeasured = { L: medTauL, R: medTauR };
  let mbTauMAD = { L: madTauL, R: madTauR };
  let mbPeaks = { L: medPkL, R: medPkR };
  let mbGeometryError = deltaConsistency;
  let mbDistances = { L: rL, R: rR };
  let mbMicPosition = { x: micX, y: geo.y > 0 ? geo.y : micYPrior };
  let mbSystemDelay = { common: tauSysCommon, L: tauSysL, R: tauSysR };

  if (config.calibration.multiband && rawPilotCaptures.length > 0 && rawRepeatCaptures.length > 0) {
    console.debug(`[calib] multiband: running ${MULTIBAND_BANDS.length} bands on ${rawPilotCaptures.length} pilot + ${rawRepeatCaptures.length} repeat captures`);

    const bandResults = MULTIBAND_BANDS.map(band =>
      runBandCalibration(band, rawPilotCaptures, rawRepeatCaptures, a, b, sr, d, c)
    );

    multibandInfo = fuseBandResults(bandResults);
    const sel = getSelectedBandResult(multibandInfo);

    console.debug(`[calib] multiband: selected=${multibandInfo.selectedBand} reason=${multibandInfo.selectionReason} agreement=${multibandInfo.bandAgreementCount} bands=${bandResults.map(b => `${b.bandId}(v=${b.valid} q=${b.quality.toFixed(3)})`).join(', ')}`);

    // If wideband is invalid, accept any valid multiband selection.
    // Otherwise only override when multiband quality is strictly better.
    if (sel && shouldUseMultibandOverride({ valid, quality }, sel)) {
      console.debug(`[calib] multiband: using band ${sel.bandId} (wideband valid=${valid} q=${quality.toFixed(3)} -> band q=${sel.quality.toFixed(3)})`);

      // Recompute geometry from the selected band's TDOA
      const mbDeltaTau = sel.deltaTau;
      const mbDeltaR = mbDeltaTau * c;
      const mbSolvedMic = solveMicGeometryFromDeltaR(mbDeltaR, d, micYPrior);
      const mbMicX = mbSolvedMic.micX;
      const mbRL = mbSolvedMic.rL;
      const mbRR = mbSolvedMic.rR;

      // Apply multiband overrides
      mbValid = sel.valid;
      mbQuality = sel.quality;
      mbAngleReliable = sel.angleReliable;
      mbMonoLikely = sel.monoLikely;
      mbTauMeasured = sel.tauMeasured;
      mbTauMAD = sel.tauMAD;
      mbPeaks = sel.peaks;
      mbGeometryError = sel.deltaConsistency;
      mbDistances = { L: mbRL, R: mbRR };
      mbMicPosition = { x: mbMicX, y: micYPrior };
      mbSystemDelay = {
        common: Math.max(0, (sel.tauMeasured.L + sel.tauMeasured.R) / 2 - (mbRL + mbRR) / 2 / c),
        L: Math.max(0, sel.tauMeasured.L - mbRL / c),
        R: Math.max(0, sel.tauMeasured.R - mbRR / c),
      };
    }
  }

  const micArrayCalibration = buildMicArrayCalibrationFromRepeats({
    repeatsByChannel: perChannelRepeats,
    clusterWindow: CLUSTER_WINDOW,
    maxTDOA,
    d,
    c,
    micYPrior,
    fallbackTauMeasured: mbTauMeasured,
    previous: state.calibration?.micArrayCalibration,
  });

  if (micArrayCalibration) {
    const validChannels = micArrayCalibration.channels.filter(ch => ch.valid).length;
    const refChannel =
      micArrayCalibration.channels.find(ch => ch.channelIndex === 0 && ch.valid)
      ?? micArrayCalibration.channels.find(ch => ch.valid)
      ?? micArrayCalibration.channels[0];

    if (micArrayCalibration.driftFromPrevious?.resetApplied) {
      const drift = micArrayCalibration.driftFromPrevious;
      console.debug(`[calib] mic-array drift guard: fallback to previous calibration (shift=${drift.maxMicShiftM.toFixed(4)}m, delayShift=${drift.maxDelayShiftMs.toFixed(3)}ms)`);
    }

    console.debug(`[calib] mic-array: channels=${micArrayCalibration.channels.length}, valid=${validChannels}, refDelay=0 at ch${refChannel.channelIndex}`);
  }

  let carrierCalibration = undefined;
  const multiplexConfigForQualification: MultiplexConfig = config.probe.type === 'multiplex'
    ? config.probe.params
    : {
      ...DEFAULT_MULTIPLEX,
      fStart: config.probe.type === 'chirp' ? Math.min(config.probe.params.f1, config.probe.params.f2) : DEFAULT_MULTIPLEX.fStart,
      fEnd: config.probe.type === 'chirp' ? Math.max(config.probe.params.f1, config.probe.params.f2) : DEFAULT_MULTIPLEX.fEnd,
    };

  try {
    console.debug(`[calib] multiplex: qualifying carriers candidates=${multiplexConfigForQualification.calibrationCandidates} target=${multiplexConfigForQualification.carrierCount}`);
    carrierCalibration = await qualifyMultiplexCarriers({
      config: multiplexConfigForQualification,
      sampleRate: sr,
      c,
      minR,
      maxR,
      heatBins,
      gain,
      listenMs,
      strengthGate: config.strengthGate,
      confidenceGate: config.confidenceGate,
      repeats: 3,
      gapMs: Math.max(12, repeatGap * 0.25),
    });
    console.debug(`[calib] multiplex: selected=${carrierCalibration.activeCarrierHz.map(f => f.toFixed(0)).join(', ')}Hz`);
  } catch (error) {
    console.warn('[calib] multiplex carrier qualification failed:', error);
  }

  const adaptiveDetection = deriveAdaptiveDetectionThresholds({
    profiles: adaptiveProfiles,
    minR,
    maxR,
    // Use the *original* user-set gates from before any prior adaptive
    // adjustment.  The calibration result stores the adaptive values that
    // were applied last time; if present, we recover the originals from
    // the current config by reverting the previous adaptation.  The
    // derivation function should operate on the user's baseline so that
    // repeated recalibrations don't ratchet the thresholds down.
    strengthGate: state.calibration?.adaptiveDetection
      ? Math.max(config.strengthGate, state.calibration.adaptiveDetection.strengthGate)
      : config.strengthGate,
    confidenceGate: state.calibration?.adaptiveDetection
      ? Math.max(config.confidenceGate, state.calibration.adaptiveDetection.confidenceGate)
      : config.confidenceGate,
    cfar: {
      ...config.cfar,
      // Restore the tighter original Pfa (smaller = stricter)
      pfa: state.calibration?.adaptiveDetection
        ? Math.min(config.cfar.pfa, state.calibration.adaptiveDetection.cfarPfa)
        : config.cfar.pfa,
    },
  });

  if (adaptiveDetection) {
    console.debug(
      `[calib] adaptive thresholds: samples=${adaptiveDetection.sampleCount} ` +
      `strengthGate ${config.strengthGate.toExponential(3)}→${adaptiveDetection.strengthGate.toExponential(3)} ` +
      `confidenceGate ${config.confidenceGate.toFixed(3)}→${adaptiveDetection.confidenceGate.toFixed(3)} ` +
      `cfarPfa ${config.cfar.pfa.toExponential(3)}→${adaptiveDetection.cfarPfa.toExponential(3)}`,
    );
  }

  const result: CalibrationResult = {
    valid: mbValid,
    quality: mbQuality,
    angleReliable: mbAngleReliable,
    monoLikely: mbMonoLikely,
    tauMeasured: mbTauMeasured,
    tauMAD: mbTauMAD,
    peaks: mbPeaks,
    distances: mbDistances,
    micPosition: mbMicPosition,
    systemDelay: mbSystemDelay,
    geometryError: mbGeometryError,
    envBaselineRaw,
    envBaselineFiltered,
    envBaseline,
    envBaselinePings,
    ambientNoise: ambientNoisePings > 0
      ? {
        pings: ambientNoisePings,
        rawPeakMedian: ambientNoiseRawPeakMedian,
        rawPeakMad: ambientNoiseRawPeakMad,
        txContrast,
      }
      : undefined,
    sanity,
    multiband: multibandInfo,
    micArrayCalibration,
    adaptiveDetection,
    carrierCalibration,
  };

  console.debug(`[calib] result: valid=${result.valid} quality=${result.quality.toFixed(3)} mono=${result.monoLikely} rL=${result.distances.L.toFixed(4)}m rR=${result.distances.R.toFixed(4)}m sysDelay={L:${(result.systemDelay.L * 1000).toFixed(3)}ms R:${(result.systemDelay.R * 1000).toFixed(3)}ms common:${(result.systemDelay.common * 1000).toFixed(3)}ms}`);
  if (result.micArrayCalibration) {
    const validCount = result.micArrayCalibration.channels.filter(ch => ch.valid).length;
    const drift = result.micArrayCalibration.driftFromPrevious;
    console.debug(`[calib] mic-array result: validChannels=${validCount}/${result.micArrayCalibration.channels.length}${drift ? ` drift={mic:${(drift.maxMicShiftM * 100).toFixed(2)}cm delay:${drift.maxDelayShiftMs.toFixed(3)}ms guard:${drift.resetApplied}}` : ''}`);
  }

  if (adaptiveDetection && result.valid) {
    store.update(s => {
      s.config.strengthGate = adaptiveDetection.strengthGate;
      s.config.confidenceGate = adaptiveDetection.confidenceGate;
      s.config.cfar.pfa = adaptiveDetection.cfarPfa;
    });
  } else if (adaptiveDetection && !result.valid) {
    console.debug('[calib] adaptive thresholds skipped: calibration timing is invalid');
  }

  store.set('calibration', result);
  store.set('status', 'ready');
  bus.emit('calibration:done', result);

  return result;
}
