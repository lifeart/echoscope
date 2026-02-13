import { store } from '../core/store.js';
import { bus } from '../core/event-bus.js';
import { clamp, sleep } from '../utils.js';
import { doPingDetailed, resetClutter } from './ping-cycle.js';
import { createHeatmap, updateHeatmapRow, averageProfiles } from './heatmap-data.js';
import type { RawAngleFrame } from '../types.js';

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
      updateHeatmapRow(heatmap, i, profile.bins, profile.bestBin, profile.bestStrength);
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
        const { averaged, bestBin, bestVal } = averageProfiles(collected);
        updateHeatmapRow(heatmap, i, averaged, bestBin, bestVal);
      }
      const averagedRaw = coherentAverageRawFrames(collectedRaw);
      if (averagedRaw) rawFrames.push(averagedRaw);
    }

    await sleep(dwell);
  }

  console.log(`[doScan] captured raw-angle frames=${rawFrames.length} of ${angles.length}`);

  // Find best target across scan
  const strengthGate = config.strengthGate;
  let bestRow = -1;
  let bestScore = -Infinity;
  for (let r = 0; r < angles.length; r++) {
    if (heatmap.bestBin[r] < 0) continue;
    if (heatmap.bestVal[r] > bestScore) {
      bestScore = heatmap.bestVal[r];
      bestRow = r;
    }
  }

  store.update(s => {
    if (bestRow >= 0 && bestScore > strengthGate) {
      s.lastDirection.angle = angles[bestRow];
      s.lastDirection.strength = bestScore;

      const b = heatmap.bestBin[bestRow];
      if (b >= 0 && Number.isFinite(minR) && Number.isFinite(maxR) && maxR > minR) {
        const rDet = minR + (b / Math.max(1, heatBins - 1)) * (maxR - minR);
        s.lastTarget.angle = angles[bestRow];
        s.lastTarget.range = rDet;
        s.lastTarget.strength = bestScore;
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

  bus.emit('scan:complete', undefined as unknown as void);
}

export function stopScan(): void {
  store.set('scanning', false);
  const state = store.get();
  store.set('status', state.audio.context ? 'ready' : 'idle');
}
