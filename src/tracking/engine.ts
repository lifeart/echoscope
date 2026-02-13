import { store } from '../core/store.js';
import { bus } from '../core/event-bus.js';
import type { Measurement, TargetState } from '../types.js';
import { MultiTargetTracker, DEFAULT_MT_CONFIG } from './multi-target.js';

const tracker = new MultiTargetTracker(DEFAULT_MT_CONFIG);
let lastUpdateMs: number | null = null;

function computeDtSec(timestampMs: number): number {
  if (!Number.isFinite(timestampMs)) return 0.1;
  if (lastUpdateMs === null) {
    lastUpdateMs = timestampMs;
    return 0.1;
  }
  const dt = (timestampMs - lastUpdateMs) / 1000;
  lastUpdateMs = timestampMs;
  if (!Number.isFinite(dt) || dt < 0) return 0;
  return Math.min(dt, 1);
}

function commitTracks(tracks: TargetState[]): TargetState[] {
  store.set('targets', tracks);
  bus.emit('target:updated', tracks);
  return tracks;
}

export function updateTrackingFromMeasurement(
  measurement: Measurement | null,
  timestampMs = Date.now(),
): TargetState[] {
  const dtSec = computeDtSec(timestampMs);
  const tracks = tracker.step(measurement ? [measurement] : [], dtSec);
  return commitTracks(tracks);
}

export function resetTrackingState(): void {
  tracker.reset();
  lastUpdateMs = null;
  commitTracks([]);
}
