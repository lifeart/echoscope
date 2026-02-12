import { store } from '../core/store.js';
import { bus } from '../core/event-bus.js';
import { sleep } from '../utils.js';
import { doPing, resetClutter } from './ping-cycle.js';
import { createHeatmap, updateHeatmapRow } from './heatmap-data.js';

export async function doScan(): Promise<void> {
  const config = store.get().config;
  store.set('scanning', true);
  store.set('status', 'scanning');

  const step = Math.max(1, config.scanStep);
  const dwell = Math.max(30, config.scanDwell);
  const minR = config.minRange;
  const maxR = config.maxRange;
  const heatBins = config.heatBins;

  const angles: number[] = [];
  for (let a = -60; a <= 60; a += step) angles.push(a);

  const heatmap = createHeatmap(angles, heatBins);
  store.set('heatmap', heatmap);
  resetClutter();

  for (let i = 0; i < angles.length; i++) {
    if (!store.get().scanning) break;
    const a = angles[i];

    store.set('config.steeringAngleDeg', a);
    bus.emit('scan:step', { angleDeg: a, index: i, total: angles.length });

    const profile = await doPing(a, i);
    updateHeatmapRow(heatmap, i, profile.bins, profile.bestBin, profile.bestStrength);

    await sleep(dwell);
  }

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
