import { store } from '../core/store.js';
import { bus } from '../core/event-bus.js';
import { clamp, sleep } from '../utils.js';
import { doPingDetailed, resetClutter } from './ping-cycle.js';
import { createHeatmap, updateHeatmapRow, aggregateProfiles } from './heatmap-data.js';
import { buildSaftHeatmap } from './saft.js';
import { pickBestFromProfile } from '../dsp/peak.js';
import { computeProfileConfidence, smooth3 } from './confidence.js';
import type { AppConfig, RawAngleFrame } from '../types.js';

const perAngleProfileHistory = new Map<number, Float32Array[]>();
let lastStableDirectionAngle: number | null = null;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  if (values.length % 2 === 0) return 0.5 * (values[mid - 1] + values[mid]);
  return values[mid];
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
    const consensusScore = smoothed[r] + 0.6 * support;
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
  if (prevScore > 0 && candScore < prevScore * 1.25) {
    return prevRow;
  }
  return candidateRow;
}

export function resetScanStabilityState(): void {
  perAngleProfileHistory.clear();
  lastStableDirectionAngle = null;
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
  let tau0Sum = 0;
  let qualitySum = 0;
  let centerFreqSum = 0;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    tau0Sum += frame.tau0;
    qualitySum += frame.quality;
    centerFreqSum += frame.centerFreqHz;
    for (let n = 0; n < len; n++) {
      corrReal[n] += frame.corrReal[n];
      corrImag[n] += frame.corrImag[n];
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
    tau0: tau0Sum * inv,
    corrReal,
    corrImag,
    centerFreqHz: centerFreqSum * inv,
    quality: qualitySum * inv,
  };
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
    console.log(`[doScan:saft] skipped (rawFrames=${rawFrames.length}, angles=${angles.length})`);
    return false;
  }
  if (angles.length < minRequiredRows) {
    console.log(`[doScan:saft] skipped (angles=${angles.length} < required=${minRequiredRows})`);
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
  console.log(`[doScan:saft] applied rows=${angles.length} bins=${heatmap.bins} halfWindow=${halfWindow} in ${elapsedMs}ms`);
  return true;
}

export async function doScan(): Promise<void> {
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
      const best = pickBestFromProfile(profile.bins);
      const filtered = applyPerAngleOutlierHistory(a, profile.bins, best.bin, outlierHistoryN, config.continuityBins);
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
        const aggregated = aggregateProfiles(collected, {
          mode: config.scanAggregateMode,
          trimFraction: config.scanTrimFraction,
        });
        const filtered = applyPerAngleOutlierHistory(
          a,
          aggregated.averaged,
          aggregated.bestBin,
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
    bus.emit('scan:complete', undefined as unknown as void);
    return;
  }

  console.log(`[doScan] captured raw-angle frames=${rawFrames.length} of ${angles.length}`);
  applySaftHeatmapIfEnabled(heatmap, rawFrames, angles, minR, maxR, config);

  const consensus = selectConsensusDirection(heatmap, {
    strengthGate: config.strengthGate,
    confidenceGate: config.confidenceGate,
    continuityBins: config.continuityBins,
  });
  let bestRow = applyAngularContinuity(consensus.row, angles, consensus.scores);

  let bestStrength = 0;
  let bestBin = -1;
  if (bestRow >= 0) {
    const profile = rowProfileView(heatmap, bestRow);
    const inferredBest = pickBestFromProfile(profile);
    bestStrength = Math.max(heatmap.bestVal[bestRow], inferredBest.val);
    bestBin = heatmap.bestBin[bestRow] >= 0 ? heatmap.bestBin[bestRow] : inferredBest.bin;
  }

  store.update(s => {
    if (bestRow >= 0 && bestStrength > config.strengthGate) {
      s.lastDirection.angle = angles[bestRow];
      s.lastDirection.strength = bestStrength;

      const b = bestBin;
      if (b >= 0 && Number.isFinite(minR) && Number.isFinite(maxR) && maxR > minR) {
        const rDet = minR + (b / Math.max(1, heatBins - 1)) * (maxR - minR);
        s.lastTarget.angle = angles[bestRow];
        s.lastTarget.range = rDet;
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

  if (bestRow >= 0) lastStableDirectionAngle = angles[bestRow];

  bus.emit('scan:complete', undefined as unknown as void);
}

export function stopScan(): void {
  store.set('scanning', false);
  const state = store.get();
  store.set('status', state.audio.context ? 'ready' : 'idle');
}
