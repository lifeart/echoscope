import { store } from '../core/store.js';
import { bus } from '../core/event-bus.js';
import { clamp, sleep, signalEnergy, energyNormalize, median } from '../utils.js';
import { doPingDetailed, resetClutter } from './ping-cycle.js';
import { createHeatmap, updateHeatmapRow, aggregateProfiles, crossAngleSmooth } from './heatmap-data.js';
import { buildSaftHeatmap } from './saft.js';
import { buildRangeProfileFromCorrelation } from '../dsp/profile.js';
import { fftCorrelateComplex } from '../dsp/fft-correlate.js';
import { estimateCorrelationEvidence } from '../dsp/correlation-evidence.js';
import { bandpassToProbe } from '../dsp/probe-band.js';
import { pickBestFromProfile } from '../dsp/peak.js';
import { applyQualityAlgorithms } from '../dsp/quality.js';
import { caCfar } from '../dsp/cfar.js';
import { findDirectPathTau } from '../calibration/direct-path.js';
import { predictedTau0ForPing } from '../calibration/engine.js';
import { computeProfileConfidence, smooth3 } from './confidence.js';
import { createProbe } from '../signal/probe-factory.js';
import { getSampleRate } from '../audio/engine.js';
import { pingAndCaptureOneSide } from '../spatial/steering.js';
import { buildRangePrior } from './range-prior.js';
import { buildJointHeatmapFromLR } from './joint-lr.js';
import { updateTrackingFromMeasurement } from '../tracking/engine.js';
import { fft, ifft, nextPow2 } from '../dsp/fft.js';
import { applyDisplayReflectionBlanking } from '../dsp/display-reflection-blanking.js';
import type { AppConfig, RawAngleFrame } from '../types.js';

// Module-level scan state. Call resetScanStabilityState() when scan
// step or angle range changes to avoid stale cross-scan blending.
const perAngleProfileHistory = new Map<number, Float32Array[]>();
const perAngleCoherentHistory = new Map<number, RawAngleFrame[]>();
let lastStableDirectionAngle: number | null = null;

/** Snapshot of previous scan heatmap for inter-scan blending.
 *  Reset via resetScanStabilityState() when scan config changes. */
let previousScanSnapshot: { data: Float32Array; bestBin: Int16Array; bestVal: Float32Array; angles: number[]; bins: number } | null = null;
const INTER_SCAN_BLEND_ALPHA = 0.65; // weight for new scan data (0.65 new + 0.35 old)

interface JointAnglePrior {
  expectedAngleDeg: number | undefined;
  sigmaDeg: number;
  source: 'none' | 'history' | 'track' | 'blended';
  trackConfidence: number;
}

function medianProfile(profiles: Float32Array[]): Float32Array {
  if (profiles.length === 0) return new Float32Array(0);
  const len = profiles[0].length;
  const out = new Float32Array(len);
  const values = new Array<number>(profiles.length);
  for (let i = 0; i < len; i++) {
    for (let p = 0; p < profiles.length; p++) values[p] = profiles[p][i];
    out[i] = median(values);
  }
  return out;
}

function rowProfileView(heatmap: ReturnType<typeof createHeatmap>, row: number): Float32Array {
  const start = row * heatmap.bins;
  return heatmap.data.subarray(start, start + heatmap.bins);
}

function applyPerAngleOutlierHistory(
  angleDeg: number,
  profile: Float32Array,
  bestBin: number,
  outlierHistoryN: number,
  continuityBins: number,
): { profile: Float32Array; bestBin: number; bestVal: number; rejected: boolean } {
  const history = perAngleProfileHistory.get(angleDeg) ?? [];
  let committed = profile;
  let rejected = false;

  if (history.length >= 3 && bestBin >= 0) {
    const bins = history.map(h => pickBestFromProfile(h).bin);
    const medBin = Math.round(median(bins));
    const isOutlier = Math.abs(bestBin - medBin) > continuityBins;
    if (isOutlier) {
      const historyMedian = medianProfile(history);
      committed = historyMedian;
      rejected = true;
    }
  }

  const committedBest = pickBestFromProfile(committed);
  const nextHistory = history.concat([Float32Array.from(committed)]);
  while (nextHistory.length > outlierHistoryN) nextHistory.shift();
  perAngleProfileHistory.set(angleDeg, nextHistory);

  return {
    profile: committed,
    bestBin: committedBest.bin,
    bestVal: committedBest.val,
    rejected,
  };
}

export interface ConsensusDirectionResult {
  row: number;
  score: number;
  scores: Float32Array;
  confidence: Float32Array;
}

export function selectConsensusDirection(
  heatmap: ReturnType<typeof createHeatmap>,
  config: Pick<AppConfig, 'strengthGate' | 'confidenceGate' | 'continuityBins'>,
): ConsensusDirectionResult {
  const rows = heatmap.angles.length;
  const rowScores = new Float32Array(rows);
  const rowConfidence = new Float32Array(rows);
  const rowBestBin = new Int16Array(rows).fill(-1);

  for (let r = 0; r < rows; r++) {
    const profile = rowProfileView(heatmap, r);
    const inferred = pickBestFromProfile(profile);
    const bestBin = heatmap.bestBin[r] >= 0 ? heatmap.bestBin[r] : inferred.bin;
    const bestVal = heatmap.bestVal[r] > 0 ? heatmap.bestVal[r] : inferred.val;
    rowBestBin[r] = bestBin;

    if (bestVal <= config.strengthGate || bestBin < 0) continue;
    const metrics = computeProfileConfidence(profile, bestBin, bestVal);
    rowConfidence[r] = metrics.confidence;
    if (metrics.confidence < config.confidenceGate) continue;
    rowScores[r] = bestVal * metrics.confidence;
  }

  const smoothed = smooth3(rowScores);
  let bestRow = -1;
  let bestScore = -Infinity;
  for (let r = 0; r < rows; r++) {
    if (rowScores[r] <= 0 || rowBestBin[r] < 0) continue;
    let support = 0;
    for (let nr = Math.max(0, r - 1); nr <= Math.min(rows - 1, r + 1); nr++) {
      if (nr === r || rowScores[nr] <= 0 || rowBestBin[nr] < 0) continue;
      const coherent = Math.abs(rowBestBin[nr] - rowBestBin[r]) <= config.continuityBins;
      support += coherent ? rowScores[nr] : -0.25 * rowScores[nr];
    }
    // Clamp negative support so incoherent neighbors can't overwhelm the
    // row's own score. Without the floor, two strong incoherent neighbors
    // can suppress a legitimate detection entirely.
    const clampedSupport = Math.max(support, -0.5 * smoothed[r]);
    const consensusScore = smoothed[r] + 0.6 * clampedSupport;
    if (consensusScore > bestScore) {
      bestScore = consensusScore;
      bestRow = r;
    }
  }

  return {
    row: bestRow,
    score: Number.isFinite(bestScore) ? bestScore : -Infinity,
    scores: smoothed,
    confidence: rowConfidence,
  };
}

export function applyAngularContinuity(
  candidateRow: number,
  angles: number[],
  scores: Float32Array,
  previousAngle: number | null = lastStableDirectionAngle,
): number {
  if (candidateRow < 0 || previousAngle == null || angles.length === 0) return candidateRow;

  let prevRow = 0;
  let minDiff = Infinity;
  for (let i = 0; i < angles.length; i++) {
    const d = Math.abs(angles[i] - previousAngle);
    if (d < minDiff) {
      minDiff = d;
      prevRow = i;
    }
  }

  if (Math.abs(candidateRow - prevRow) <= 2) return candidateRow;

  const prevScore = scores[prevRow] ?? 0;
  const candScore = scores[candidateRow] ?? 0;
  if (prevScore > 0 && candScore < prevScore * 1.5) {
    return prevRow;
  }
  return candidateRow;
}

export function resetScanStabilityState(): void {
  perAngleProfileHistory.clear();
  perAngleCoherentHistory.clear();
  lastStableDirectionAngle = null;
  previousScanSnapshot = null;
}

/**
 * Blend current heatmap data with the previous scan's snapshot.
 * Smooths out scan-to-scan noise so that targets remain stable
 * when scanned repeatedly from the same location.
 */
function blendWithPreviousScan(heatmap: ReturnType<typeof createHeatmap>): void {
  if (!previousScanSnapshot) return;
  const prev = previousScanSnapshot;
  if (prev.bins !== heatmap.bins || prev.angles.length !== heatmap.angles.length) return;
  // Verify angles match
  for (let i = 0; i < heatmap.angles.length; i++) {
    if (prev.angles[i] !== heatmap.angles[i]) return;
  }
  const alpha = INTER_SCAN_BLEND_ALPHA;
  for (let i = 0; i < heatmap.data.length; i++) {
    heatmap.data[i] = alpha * heatmap.data[i] + (1 - alpha) * prev.data[i];
  }
  // Re-derive bestBin/bestVal from blended data
  for (let r = 0; r < heatmap.angles.length; r++) {
    const profile = heatmap.data.subarray(r * heatmap.bins, (r + 1) * heatmap.bins);
    const best = pickBestFromProfile(profile);
    heatmap.bestBin[r] = best.bin;
    heatmap.bestVal[r] = best.val;
  }
}

/** Save a snapshot of the current heatmap data for the next scan's blending. */
function saveScanSnapshot(heatmap: ReturnType<typeof createHeatmap>): void {
  previousScanSnapshot = {
    data: Float32Array.from(heatmap.data),
    bestBin: Int16Array.from(heatmap.bestBin),
    bestVal: Float32Array.from(heatmap.bestVal),
    angles: heatmap.angles.slice(),
    bins: heatmap.bins,
  };
}

function resetScanFrameHistory(): void {
  perAngleProfileHistory.clear();
  perAngleCoherentHistory.clear();
}

function resolveJointAnglePrior(
  targets: ReturnType<typeof store.get>['targets'],
  historyAngleDeg: number | null,
): JointAnglePrior {
  const historyAngle = Number.isFinite(historyAngleDeg ?? NaN) ? (historyAngleDeg as number) : undefined;

  let bestTrackAngle: number | undefined;
  let bestTrackConfidence = 0;
  let bestTrackMiss = 0;
  for (const target of targets) {
    const angle = target.position?.angleDeg;
    if (!Number.isFinite(angle)) continue;
    const conf = clamp(target.confidence, 0, 1);
    const missPenalty = clamp(target.missCount / 8, 0, 1);
    const score = conf * (1 - 0.55 * missPenalty);
    if (score > bestTrackConfidence) {
      bestTrackConfidence = score;
      bestTrackAngle = angle;
      bestTrackMiss = target.missCount;
    }
  }

  if (bestTrackAngle == null && historyAngle == null) {
    return { expectedAngleDeg: undefined, sigmaDeg: 30, source: 'none', trackConfidence: 0 };
  }

  if (bestTrackAngle == null) {
    return { expectedAngleDeg: historyAngle, sigmaDeg: 24, source: 'history', trackConfidence: 0 };
  }

  const conf = clamp(bestTrackConfidence, 0, 1);
  const missPenalty = clamp(bestTrackMiss / 6, 0, 1);
  const sigmaTrack = clamp(28 - conf * 14 + missPenalty * 8, 10, 34);

  if (historyAngle == null) {
    return {
      expectedAngleDeg: bestTrackAngle,
      sigmaDeg: sigmaTrack,
      source: 'track',
      trackConfidence: conf,
    };
  }

  const trackWeight = clamp(0.45 + 0.45 * conf - 0.20 * missPenalty, 0.20, 0.90);
  const expectedAngleDeg = bestTrackAngle * trackWeight + historyAngle * (1 - trackWeight);
  const sigmaDeg = clamp(sigmaTrack * (1 - 0.10 * trackWeight), 10, 30);
  return {
    expectedAngleDeg,
    sigmaDeg,
    source: 'blended',
    trackConfidence: conf,
  };
}

async function captureOneSideRangeProfile(
  side: 'L' | 'R',
  ref: Float32Array,
  gain: number,
  listenMs: number,
  minR: number,
  maxR: number,
  c: number,
  heatBins: number,
  lockStrength: number,
  sampleRate: number,
): Promise<Float32Array> {
  const capture = await pingAndCaptureOneSide(ref, side, gain, listenMs);
  // Bandpass-filter mic to the probe frequency band to reject out-of-band noise
  const probeConfig = store.get().config.probe;
  const micFiltered = bandpassToProbe(capture.micWin, probeConfig, sampleRate);
  const corr = fftCorrelateComplex(micFiltered, ref, sampleRate).correlation;
  // TX evidence uses FILTERED mic signal — energy must match the correlation source.
  const txEvidence = estimateCorrelationEvidence(corr, micFiltered, ref);
  if (!txEvidence.pass) {
    console.debug(`[scan:corrEvidence] side=${side} txNorm=${txEvidence.peakNorm.toFixed(3)} txProm=${txEvidence.prominence.toFixed(2)} txWidth=${txEvidence.peakWidth} txPass=${txEvidence.pass} -> zero profile`);
    return new Float32Array(heatBins);
  }
  energyNormalize(corr, signalEnergy(ref));

  const predictedTau = predictedTau0ForPing(capture.delay, capture.delay);
  const tau0 = findDirectPathTau(corr, predictedTau, lockStrength, sampleRate);
  let profile = buildRangeProfileFromCorrelation(corr, tau0, c, minR, maxR, sampleRate, heatBins);

  const algo = store.get().config.qualityAlgo;
  profile = applyQualityAlgorithms(profile, algo === 'auto' ? 'balanced' : algo);
  return profile;
}

async function captureOneSideRangeProfileGolay(
  side: 'L' | 'R',
  a: Float32Array,
  b: Float32Array,
  gapMs: number,
  gain: number,
  listenMs: number,
  minR: number,
  maxR: number,
  c: number,
  heatBins: number,
  lockStrength: number,
  sampleRate: number,
): Promise<Float32Array> {
  const capA = await pingAndCaptureOneSide(a, side, gain, listenMs);
  if (gapMs > 0) await sleep(gapMs);
  const capB = await pingAndCaptureOneSide(b, side, gain, listenMs);

  // Bandpass-filter mic signals to the probe frequency band
  const probeConfig = store.get().config.probe;
  const micAFiltered = bandpassToProbe(capA.micWin, probeConfig, sampleRate);
  const micBFiltered = bandpassToProbe(capB.micWin, probeConfig, sampleRate);
  const corrA = fftCorrelateComplex(micAFiltered, a, sampleRate).correlation;
  const corrB = fftCorrelateComplex(micBFiltered, b, sampleRate).correlation;
  // TX evidence uses FILTERED mic signals — energy must match correlation source.
  const txEvidenceA = estimateCorrelationEvidence(corrA, micAFiltered, a);
  const txEvidenceB = estimateCorrelationEvidence(corrB, micBFiltered, b);
  // Require BOTH halves to pass — noise randomly passes ~30% per half,
  // OR gate gives ~50%+ false positive. AND gate: ~9%.
  if (!txEvidenceA.pass || !txEvidenceB.pass) {
    console.debug(`[scan:golayEvidence] side=${side} txA=${txEvidenceA.pass} txB=${txEvidenceB.pass} normA=${txEvidenceA.peakNorm.toFixed(3)} normB=${txEvidenceB.peakNorm.toFixed(3)} widthA=${txEvidenceA.peakWidth} widthB=${txEvidenceB.peakWidth} -> zero profile`);
    return new Float32Array(heatBins);
  }
  const len = Math.min(corrA.length, corrB.length);
  const corr = new Float32Array(len);
  for (let i = 0; i < len; i++) corr[i] = corrA[i] + corrB[i];
  energyNormalize(corr, signalEnergy(a) + signalEnergy(b));

  const predictedTau = predictedTau0ForPing(capA.delay, capA.delay);
  const tau0 = findDirectPathTau(corr, predictedTau, lockStrength, sampleRate);
  let profile = buildRangeProfileFromCorrelation(corr, tau0, c, minR, maxR, sampleRate, heatBins);

  const algo = store.get().config.qualityAlgo;
  profile = applyQualityAlgorithms(profile, algo === 'auto' ? 'balanced' : algo);
  return profile;
}

function selectBestRowByScores(scores: Float32Array): number {
  let bestRow = -1;
  let bestScore = 0;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > bestScore) {
      bestScore = scores[i];
      bestRow = i;
    }
  }
  return bestRow;
}

function pickBestBinInRange(profile: Float32Array, start: number, endExclusive: number): { bin: number; val: number } {
  const s = Math.max(0, Math.min(profile.length, start | 0));
  const e = Math.max(s, Math.min(profile.length, endExclusive | 0));
  let bestBin = -1;
  let bestVal = -Infinity;
  for (let i = s; i < e; i++) {
    const v = profile[i];
    if (v > bestVal) {
      bestVal = v;
      bestBin = i;
    }
  }
  if (bestBin < 0 || !Number.isFinite(bestVal)) return { bin: -1, val: 0 };
  return { bin: bestBin, val: bestVal };
}

export function resolveBestDetectionFromRow(
  heatmap: ReturnType<typeof createHeatmap>,
  bestRow: number,
  minR: number,
  maxR: number,
  preBlendRowBest?: { bestBin: Int16Array; bestVal: Float32Array },
): { bestBin: number; bestStrength: number; bestRange: number } {
  let bestStrength = 0;
  let bestBin = -1;
  let bestRange = NaN;

  if (bestRow < 0 || bestRow >= heatmap.angles.length) {
    return { bestBin, bestStrength, bestRange };
  }

  const profile = rowProfileView(heatmap, bestRow);

  if (preBlendRowBest) {
    const preBestBin = preBlendRowBest.bestBin[bestRow] ?? -1;
    const preBestVal = preBlendRowBest.bestVal[bestRow] ?? 0;
    if (preBestBin >= 0 && preBestVal > 0) {
      // Prefer pre-blend gated peak: blending is for display stability and
      // should not override the current scan's accepted detection.
      bestBin = preBestBin;
      bestStrength = preBestVal;
    }
  }

  if (bestBin < 0) {
    const inferredBest = pickBestFromProfile(profile);
    bestStrength = Math.max(heatmap.bestVal[bestRow], inferredBest.val);
    bestBin = heatmap.bestBin[bestRow] >= 0 ? heatmap.bestBin[bestRow] : inferredBest.bin;
  }

  // Near-edge peaks are often direct-path leakage or display reflections.
  // Prefer a nearby interior peak when it is reasonably strong.
  if (bestBin >= 0 && heatmap.bins > 4) {
    const guardBins = Math.max(3, Math.floor(heatmap.bins * 0.03));
    const nearEdge = bestBin <= guardBins || bestBin >= (heatmap.bins - 1 - guardBins);
    if (nearEdge && guardBins + 2 < heatmap.bins - 1 - guardBins) {
      const interior = pickBestBinInRange(profile, guardBins + 1, heatmap.bins - 1 - guardBins);
      if (interior.bin >= 0 && interior.val > 0) {
        const span = Math.max(1e-9, maxR - minR);
        const binSpan = span / Math.max(1, heatmap.bins - 1);
        const edgeRange = minR + bestBin * binSpan;
        const nearMinRange = edgeRange <= (minR + Math.max(0.08, 2 * binSpan));
        const ratio = nearMinRange ? 0.58 : 0.72;
        if (interior.val >= bestStrength * ratio) {
          bestBin = interior.bin;
          bestStrength = interior.val;
        }
      }
    }
  }

  if (bestBin >= 0 && Number.isFinite(minR) && Number.isFinite(maxR) && maxR > minR) {
    bestRange = minR + (bestBin / Math.max(1, heatmap.bins - 1)) * (maxR - minR);
  }

  return { bestBin, bestStrength, bestRange };
}

/**
 * Shift a complex signal by a fractional number of samples using an exact
 * FFT phase-ramp.  This applies X_shifted[k] = X[k] · e^{-j 2π k Δ/N}
 * and is exact (no interpolation error) for band-limited signals.
 */
export function fftFractionalShift(
  real: Float32Array,
  imag: Float32Array,
  shiftSamples: number,
): { real: Float32Array; imag: Float32Array } {
  const len = real.length;
  if (len === 0 || Math.abs(shiftSamples) < 1e-9) {
    return { real, imag };
  }

  const N = nextPow2(len);
  // Zero-pad to power of 2 for FFT
  const rr = new Float32Array(N);
  const ri = new Float32Array(N);
  rr.set(real);
  ri.set(imag);

  fft(rr, ri);

  // Apply phase ramp: e^{-j 2π k shift / N}
  for (let k = 0; k < N; k++) {
    const phase = -2 * Math.PI * k * shiftSamples / N;
    const c = Math.cos(phase);
    const s = Math.sin(phase);
    const newR = rr[k] * c - ri[k] * s;
    const newI = rr[k] * s + ri[k] * c;
    rr[k] = newR;
    ri[k] = newI;
  }

  ifft(rr, ri);

  // Truncate back to original length
  return { real: rr.subarray(0, len), imag: ri.subarray(0, len) };
}

function coherentAverageRawFrames(frames: RawAngleFrame[]): RawAngleFrame | null {
  if (frames.length === 0) return null;
  if (frames.length === 1) return frames[0];

  const first = frames[0];
  const minLen = frames.reduce((acc, f) => Math.min(acc, f.corrReal.length, f.corrImag.length), Infinity);
  if (!Number.isFinite(minLen) || minLen <= 0) return null;

  const len = Math.floor(minLen);
  const corrReal = new Float32Array(len);
  const corrImag = new Float32Array(len);
  let qualitySum = 0;
  let centerFreqSum = 0;

  // Use first frame's tau0 as the reference; shift all other frames to
  // align their correlation peaks before averaging. Without this alignment,
  // sub-sample tau0 jitter causes destructive interference at the peak,
  // degrading SNR instead of improving it.
  //
  // Alignment uses an exact FFT phase-ramp shift rather than linear
  // interpolation, eliminating frequency-dependent interpolation error.
  const refTau0 = first.tau0;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    qualitySum += frame.quality;
    centerFreqSum += frame.centerFreqHz;

    // Compute the sample offset needed to align this frame's tau0 to refTau0
    const deltaTau = frame.tau0 - refTau0;
    const shiftSamples = deltaTau * frame.sampleRate;

    // Apply exact fractional shift via FFT phase ramp
    const shifted = fftFractionalShift(
      frame.corrReal.subarray(0, len),
      frame.corrImag.subarray(0, len),
      shiftSamples,
    );
    for (let n = 0; n < len; n++) {
      corrReal[n] += shifted.real[n];
      corrImag[n] += shifted.imag[n];
    }
  }

  const inv = 1 / frames.length;
  for (let n = 0; n < len; n++) {
    corrReal[n] *= inv;
    corrImag[n] *= inv;
  }

  return {
    angleDeg: first.angleDeg,
    sampleRate: first.sampleRate,
    tau0: refTau0,
    corrReal,
    corrImag,
    centerFreqHz: centerFreqSum * inv,
    quality: qualitySum * inv,
  };
}

function coherentIntegrateAndBuildProfile(
  rawFrame: RawAngleFrame,
  maxHistory: number,
  c: number,
  minR: number,
  maxR: number,
  heatBins: number,
): { profile: Float32Array; tau0: number } {
  const angleDeg = rawFrame.angleDeg;
  const history = perAngleCoherentHistory.get(angleDeg) ?? [];
  history.push(rawFrame);
  while (history.length > maxHistory) history.shift();
  perAngleCoherentHistory.set(angleDeg, history);

  if (history.length <= 1) {
    const prof = buildRangeProfileFromCorrelation(
      rawFrame.corrReal, rawFrame.tau0, c, minR, maxR, rawFrame.sampleRate, heatBins,
    );
    return { profile: prof, tau0: rawFrame.tau0 };
  }

  // Average complex correlations
  const averaged = coherentAverageRawFrames(history);
  if (!averaged) {
    const prof = buildRangeProfileFromCorrelation(
      rawFrame.corrReal, rawFrame.tau0, c, minR, maxR, rawFrame.sampleRate, heatBins,
    );
    return { profile: prof, tau0: rawFrame.tau0 };
  }

  const prof = buildRangeProfileFromCorrelation(
    averaged.corrReal, averaged.tau0, c, minR, maxR, averaged.sampleRate, heatBins,
  );
  return { profile: prof, tau0: averaged.tau0 };
}

export function applySaftHeatmapIfEnabled(
  heatmap: ReturnType<typeof createHeatmap>,
  rawFrames: RawAngleFrame[],
  angles: number[],
  minRange: number,
  maxRange: number,
  cfg: Pick<AppConfig, 'virtualArray' | 'spacing' | 'speedOfSound'>,
): boolean {
  const va = cfg.virtualArray;
  const halfWindow = Math.max(0, Math.floor(va.halfWindow));
  const minRequiredRows = Math.max(3, 2 * halfWindow + 1);

  if (!va.enabled) return false;
  if (rawFrames.length !== angles.length) {
    console.debug(`[doScan:saft] skipped (rawFrames=${rawFrames.length}, angles=${angles.length})`);
    return false;
  }
  if (angles.length < minRequiredRows) {
    console.debug(`[doScan:saft] skipped (angles=${angles.length} < required=${minRequiredRows})`);
    return false;
  }

  const t0 = Date.now();
  const saft = buildSaftHeatmap({
    rawFrames,
    scanAngles: angles,
    minRange,
    maxRange,
    bins: heatmap.bins,
    spacing: cfg.spacing,
    speedOfSound: cfg.speedOfSound,
    config: va,
  });

  heatmap.data.set(saft.data);
  heatmap.display.fill(0);
  heatmap.bestBin.set(saft.bestBin);
  heatmap.bestVal.set(saft.bestVal);

  const elapsedMs = Date.now() - t0;
  console.debug(`[doScan:saft] applied rows=${angles.length} bins=${heatmap.bins} halfWindow=${halfWindow} in ${elapsedMs}ms`);
  return true;
}

async function doScanTxSteeringLegacy(): Promise<void> {
  const config = store.get().config;
  store.set('scanning', true);
  store.set('status', 'scanning');

  const step = Math.max(1, config.scanStep);
  const dwell = Math.max(30, config.scanDwell);
  const minR = config.minRange;
  const maxR = config.maxRange;
  const heatBins = config.heatBins;
  const passes = clamp(config.scanPasses, 1, 8);
  const outlierHistoryN = Math.max(3, Math.min(9, Math.floor(config.outlierHistoryN)));

  const angles: number[] = [];
  for (let a = -60; a <= 60; a += step) angles.push(a);

  const heatmap = createHeatmap(angles, heatBins);
  const rawFrames: RawAngleFrame[] = [];
  store.set('heatmap', heatmap);
  // Reset lastTarget so per-angle best-so-far tracking starts fresh
  store.update(s => {
    s.lastTarget.angle = NaN;
    s.lastTarget.range = NaN;
    s.lastTarget.strength = 0;
  });
  resetClutter();

  for (let i = 0; i < angles.length; i++) {
    if (!store.get().scanning) break;
    const a = angles[i];
    store.set('config.steeringAngleDeg', a);

    if (passes === 1) {
      bus.emit('scan:step', { angleDeg: a, index: i, total: angles.length, pass: 0, totalPasses: 1 });
      const detailed = await doPingDetailed(a, i);
      const profile = detailed.profile;
      rawFrames.push(detailed.rawFrame);

      // Apply coherent temporal integration if depth > 1
      let profileBins = profile.bins;
      const coherentDepth = config.coherentIntegrationDepth ?? 1;
      if (coherentDepth > 1) {
        const integrated = coherentIntegrateAndBuildProfile(
          detailed.rawFrame, coherentDepth, config.speedOfSound, minR, maxR, heatBins,
        );
        profileBins = integrated.profile;
      }

      const best = pickBestFromProfile(profileBins);
      const filtered = applyPerAngleOutlierHistory(a, profileBins, best.bin, outlierHistoryN, config.continuityBins);
      updateHeatmapRow(heatmap, i, filtered.profile, filtered.bestBin, filtered.bestVal, {
        decayFactor: 0.90,
        temporalIirAlpha: config.temporalIirAlpha,
      });
    } else {
      const collected: Float32Array[] = [];
      const collectedRaw: RawAngleFrame[] = [];
      for (let p = 0; p < passes; p++) {
        if (!store.get().scanning) break;
        bus.emit('scan:step', { angleDeg: a, index: i, total: angles.length, pass: p, totalPasses: passes });
        const detailed = await doPingDetailed(a, i);
        collected.push(detailed.profile.bins);
        collectedRaw.push(detailed.rawFrame);
        if (p < passes - 1) await sleep(dwell);
      }
      if (collected.length > 0) {
        // Use coherent accumulation for deterministic signals (Golay/MLS), incoherent for chirp
        const isDeterministic = config.probe.type === 'golay' || config.probe.type === 'mls' || config.probe.type === 'multiplex';
        let profileBins: Float32Array;
        let bestBin: number;

        if (isDeterministic && collectedRaw.length > 1) {
          const averaged = coherentAverageRawFrames(collectedRaw);
          if (averaged) {
            profileBins = buildRangeProfileFromCorrelation(
              averaged.corrReal, averaged.tau0, config.speedOfSound, minR, maxR, averaged.sampleRate, heatBins,
            );
            const best = pickBestFromProfile(profileBins);
            bestBin = best.bin;
          } else {
            const aggregated = aggregateProfiles(collected, {
              mode: config.scanAggregateMode,
              trimFraction: config.scanTrimFraction,
            });
            profileBins = aggregated.averaged;
            bestBin = aggregated.bestBin;
          }
        } else {
          const aggregated = aggregateProfiles(collected, {
            mode: config.scanAggregateMode,
            trimFraction: config.scanTrimFraction,
          });
          profileBins = aggregated.averaged;
          bestBin = aggregated.bestBin;
        }

        const filtered = applyPerAngleOutlierHistory(
          a,
          profileBins,
          bestBin,
          outlierHistoryN,
          config.continuityBins,
        );
        updateHeatmapRow(heatmap, i, filtered.profile, filtered.bestBin, filtered.bestVal, {
          decayFactor: 0.90,
          temporalIirAlpha: config.temporalIirAlpha,
        });
      }
      const averagedRaw = coherentAverageRawFrames(collectedRaw);
      if (averagedRaw) rawFrames.push(averagedRaw);
    }

    await sleep(dwell);
  }

  // Scan was cancelled mid-run (e.g. user pressed Stop). Avoid committing
  // consensus/target updates from partial data.
  if (!store.get().scanning) {
    const state = store.get();
    store.set('status', state.audio.context ? 'ready' : 'idle');
    bus.emit('scan:complete');
    return;
  }

  console.debug(`[doScan] captured raw-angle frames=${rawFrames.length} of ${angles.length}`);
  applySaftHeatmapIfEnabled(heatmap, rawFrames, angles, minR, maxR, config);

  // Cross-angle smoothing (median filter across adjacent angles)
  if (config.crossAngleSmooth?.enabled) {
    crossAngleSmooth(heatmap, config.crossAngleSmooth.radius ?? 1);
  }

  // Blend with previous scan data to stabilize targets across scans
  blendWithPreviousScan(heatmap);

  const consensus = selectConsensusDirection(heatmap, {
    strengthGate: config.strengthGate,
    confidenceGate: config.confidenceGate,
    continuityBins: config.continuityBins,
  });
  let bestRow = applyAngularContinuity(consensus.row, angles, consensus.scores);

  const resolvedBest = resolveBestDetectionFromRow(heatmap, bestRow, minR, maxR);
  const bestStrength = resolvedBest.bestStrength;
  const bestBin = resolvedBest.bestBin;
  const bestRange = resolvedBest.bestRange;

  store.update(s => {
    if (bestRow >= 0 && bestStrength > config.strengthGate) {
      s.lastDirection.angle = angles[bestRow];
      s.lastDirection.strength = bestStrength;

      const b = bestBin;
      if (b >= 0 && Number.isFinite(minR) && Number.isFinite(maxR) && maxR > minR) {
        s.lastTarget.angle = angles[bestRow];
        s.lastTarget.range = bestRange;
        s.lastTarget.strength = bestStrength;
      }
    } else {
      s.lastDirection.angle = NaN;
      s.lastDirection.strength = 0;
      s.lastTarget.angle = NaN;
      s.lastTarget.range = NaN;
      s.lastTarget.strength = 0;
    }

    // Set lastProfile from the consensus direction's raw frame so the
    // profile plot shows the best angle's correlation, not the last-pinged one.
    if (bestRow >= 0 && bestRow < rawFrames.length) {
      const bestFrame = rawFrames[bestRow];
      s.lastProfile.corr = bestFrame.corrReal;
      s.lastProfile.tau0 = bestFrame.tau0;
      s.lastProfile.c = config.speedOfSound;
      s.lastProfile.minR = minR;
      s.lastProfile.maxR = maxR;
    }

    s.scanning = false;
    s.status = 'ready';
  });

  const scanTs = Date.now();
  if (bestRow >= 0 && bestStrength > config.strengthGate && Number.isFinite(bestRange)) {
    updateTrackingFromMeasurement({
      range: bestRange,
      angleDeg: angles[bestRow],
      strength: bestStrength,
      timestamp: scanTs,
    }, scanTs);
  } else {
    updateTrackingFromMeasurement(null, scanTs);
  }

  if (bestRow >= 0) lastStableDirectionAngle = angles[bestRow];
  saveScanSnapshot(heatmap);

  bus.emit('scan:complete');
}

export async function doScan(): Promise<void> {
  resetScanFrameHistory();
  const config = store.get().config;

  const sampleRate = getSampleRate();
  const probe = createProbe(config.probe, sampleRate);

  if (probe.type === 'golay') {
    if (!probe.a || !probe.b) {
      await doScanTxSteeringLegacy();
      return;
    }
  } else if (!probe.ref) {
    await doScanTxSteeringLegacy();
    return;
  }

  store.set('scanning', true);
  store.set('status', 'scanning');

  const step = Math.max(1, config.scanStep);
  const dwell = Math.max(30, config.scanDwell);
  const minR = config.minRange;
  const maxR = config.maxRange;
  const heatBins = config.heatBins;
  const passes = clamp(config.scanPasses, 1, 8);
  const c = config.speedOfSound;
  const gain = config.gain;
  const listenMs = config.listenMs;
  const lockStrength = (store.get().calibration?.valid && config.calibration.useCalib)
    ? store.get().calibration!.quality
    : 0;

  const angles: number[] = [];
  for (let a = -60; a <= 60; a += step) angles.push(a);

  const heatmap = createHeatmap(angles, heatBins);
  store.set('heatmap', heatmap);
  resetClutter();

  const leftProfiles: Float32Array[] = [];
  const rightProfiles: Float32Array[] = [];
  const probeLen = probe.ref
    ? probe.ref.length
    : Math.max(probe.a?.length ?? 0, probe.b?.length ?? 0);
  const waveMs = (probeLen / Math.max(1, sampleRate)) * 1000;
  const maxEchoMs = (2 * maxR / Math.max(1e-6, c)) * 1000;
  const sideGapMs = Math.max(40, Math.ceil(waveMs + maxEchoMs + 8));
  const golayGapMs = probe.type === 'golay' ? Math.max(0, probe.gapMs ?? 12) : 0;

  for (let p = 0; p < passes; p++) {
    if (!store.get().scanning) break;

    bus.emit('scan:step', {
      angleDeg: 0,
      index: p * 2,
      total: passes * 2,
      pass: p,
      totalPasses: passes,
    });
    const left = probe.type === 'golay'
      ? await captureOneSideRangeProfileGolay(
        'L',
        probe.a!,
        probe.b!,
        golayGapMs,
        gain,
        listenMs,
        minR,
        maxR,
        c,
        heatBins,
        lockStrength,
        sampleRate,
      )
      : await captureOneSideRangeProfile(
        'L', probe.ref!, gain, listenMs, minR, maxR, c, heatBins, lockStrength, sampleRate,
      );
    leftProfiles.push(left);

    if (!store.get().scanning) break;
    await sleep(sideGapMs);

    bus.emit('scan:step', {
      angleDeg: 0,
      index: p * 2 + 1,
      total: passes * 2,
      pass: p,
      totalPasses: passes,
    });
    const right = probe.type === 'golay'
      ? await captureOneSideRangeProfileGolay(
        'R',
        probe.a!,
        probe.b!,
        golayGapMs,
        gain,
        listenMs,
        minR,
        maxR,
        c,
        heatBins,
        lockStrength,
        sampleRate,
      )
      : await captureOneSideRangeProfile(
        'R', probe.ref!, gain, listenMs, minR, maxR, c, heatBins, lockStrength, sampleRate,
      );
    rightProfiles.push(right);

    if (p < passes - 1) await sleep(dwell);
  }

  if (!store.get().scanning) {
    const state = store.get();
    store.set('status', state.audio.context ? 'ready' : 'idle');
    bus.emit('scan:complete');
    return;
  }

  if (leftProfiles.length === 0 || rightProfiles.length === 0) {
    store.set('scanning', false);
    store.set('status', 'ready');
    bus.emit('scan:complete');
    return;
  }

  const aggregatedL = aggregateProfiles(leftProfiles, {
    mode: config.scanAggregateMode,
    trimFraction: config.scanTrimFraction,
  }).averaged;
  const aggregatedR = aggregateProfiles(rightProfiles, {
    mode: config.scanAggregateMode,
    trimFraction: config.scanTrimFraction,
  }).averaged;

  // Profile energy gate: if the aggregated profile is essentially zero
  // (all passes returned zeroed profiles due to TX evidence failure),
  // skip the joint heatmap entirely — no real signal was detected.
  let maxL = 0, maxR_ = 0;
  for (let i = 0; i < aggregatedL.length; i++) if (aggregatedL[i] > maxL) maxL = aggregatedL[i];
  for (let i = 0; i < aggregatedR.length; i++) if (aggregatedR[i] > maxR_) maxR_ = aggregatedR[i];
  console.debug(`[doScan:LR] aggregatedL max=${maxL.toExponential(3)} aggregatedR max=${maxR_.toExponential(3)}`);

  if (maxL < 1e-10 || maxR_ < 1e-10) {
    console.debug(`[doScan:LR] profile energy gate: L or R profile is essentially zero -> no detection`);
    store.update(s => {
      s.lastDirection.angle = NaN;
      s.lastDirection.strength = 0;
      s.lastTarget.angle = NaN;
      s.lastTarget.range = NaN;
      s.lastTarget.strength = 0;
      s.scanning = false;
      s.status = 'ready';
    });
    updateTrackingFromMeasurement(null, Date.now());
    bus.emit('scan:complete');
    return;
  }

  // Keep L/R scan preprocessing consistent with single-ping pipeline:
  // when display blanking is enabled, suppress near-field bins before fusion.
  const profileLForJoint = config.displayReflectionBlanking.enabled
    ? applyDisplayReflectionBlanking(aggregatedL, minR, maxR, config.displayReflectionBlanking)
    : aggregatedL;
  const profileRForJoint = config.displayReflectionBlanking.enabled
    ? applyDisplayReflectionBlanking(aggregatedR, minR, maxR, config.displayReflectionBlanking)
    : aggregatedR;

  const stateBeforeJoint = store.get();
  const prior = buildRangePrior(
    stateBeforeJoint.targets,
    stateBeforeJoint.lastTarget.range,
    minR,
    maxR,
  );
  const anglePrior = resolveJointAnglePrior(stateBeforeJoint.targets, lastStableDirectionAngle);

  const joint = buildJointHeatmapFromLR({
    profileL: profileLForJoint,
    profileR: profileRForJoint,
    anglesDeg: angles,
    minRange: minR,
    maxRange: maxR,
    speakerSpacingM: config.spacing,
    priorRangeM: prior?.center,
    priorSigmaM: prior?.sigma,
    prevAngleDeg: anglePrior.expectedAngleDeg,
    angleSigmaDeg: anglePrior.sigmaDeg,
    edgeMaskBins: Math.max(3, Math.floor(heatBins * 0.03)),
  });

  heatmap.data.set(joint.data);
  heatmap.display.fill(0);
  heatmap.bestBin.set(joint.bestBin);
  heatmap.bestVal.set(joint.bestVal);

  if (config.crossAngleSmooth?.enabled) {
    crossAngleSmooth(heatmap, config.crossAngleSmooth.radius ?? 1);
  }

  // Apply CFAR + confidence gating per row BEFORE inter-scan blending.
  // CFAR statistics depend on the current noise floor; blending with the
  // previous scan alters those statistics and can mask false alarms.
  // The legacy TX-steering path applies CFAR inside doPingDetailed (before
  // any blending), so this ordering keeps both paths consistent.
  const rowScores = new Float32Array(angles.length);
  const rowBestBinPreBlend = new Int16Array(angles.length).fill(-1);
  const rowBestValPreBlend = new Float32Array(angles.length);
  for (let i = 0; i < angles.length; i++) {
    const profile = rowProfileView(heatmap, i);
    const bestBinI = heatmap.bestBin[i] >= 0 ? heatmap.bestBin[i] : pickBestFromProfile(profile).bin;
    const bestValI = heatmap.bestVal[i] > 0 ? heatmap.bestVal[i] : pickBestFromProfile(profile).val;
    if (bestBinI < 0 || bestValI <= config.strengthGate) continue;

    const confMetrics = computeProfileConfidence(profile, bestBinI, bestValI);
    if (confMetrics.confidence < config.confidenceGate) continue;

    const cfarRes = caCfar(profile, config.cfar);
    const cfarOk = cfarRes.detections[bestBinI] === 1;
    if (!cfarOk) continue;

    rowScores[i] = bestValI * confMetrics.confidence;
    rowBestBinPreBlend[i] = bestBinI;
    rowBestValPreBlend[i] = bestValI;
  }

  // Blend with previous scan data to stabilize targets across scans
  // (after CFAR gating to preserve noise-floor statistics)
  blendWithPreviousScan(heatmap);
  const rowCandidate = selectBestRowByScores(rowScores);
  const bestRow = applyAngularContinuity(rowCandidate, angles, rowScores);

  const resolvedBest = resolveBestDetectionFromRow(
    heatmap,
    bestRow,
    minR,
    maxR,
    { bestBin: rowBestBinPreBlend, bestVal: rowBestValPreBlend },
  );
  const bestStrength = resolvedBest.bestStrength;
  const bestBin = resolvedBest.bestBin;
  const bestRange = resolvedBest.bestRange;

  store.update(s => {
    if (bestRow >= 0 && bestStrength > config.strengthGate) {
      s.lastDirection.angle = angles[bestRow];
      s.lastDirection.strength = bestStrength;

      if (bestBin >= 0 && Number.isFinite(bestRange)) {
        s.lastTarget.angle = angles[bestRow];
        s.lastTarget.range = bestRange;
        s.lastTarget.strength = bestStrength;
      }
    } else {
      s.lastDirection.angle = NaN;
      s.lastDirection.strength = 0;
      s.lastTarget.angle = NaN;
      s.lastTarget.range = NaN;
      s.lastTarget.strength = 0;
    }

    s.scanning = false;
    s.status = 'ready';
  });

  const scanTs = Date.now();
  if (bestRow >= 0 && bestStrength > config.strengthGate && Number.isFinite(bestRange)) {
    updateTrackingFromMeasurement({
      range: bestRange,
      angleDeg: angles[bestRow],
      strength: bestStrength,
      timestamp: scanTs,
    }, scanTs);
  } else {
    updateTrackingFromMeasurement(null, scanTs);
  }

  if (bestRow >= 0) lastStableDirectionAngle = angles[bestRow];
  saveScanSnapshot(heatmap);
  bus.emit('scan:complete');
}

export function stopScan(): void {
  store.set('scanning', false);
  const state = store.get();
  store.set('status', state.audio.context ? 'ready' : 'idle');
}
