import type { TargetState, Measurement } from '../types.js';
import {
  createTarget,
  predict,
  update,
  mahalanobisDistance,
  DEFAULT_KALMAN_CONFIG,
  type KalmanConfig,
} from './kalman.js';

export interface MultiTargetConfig {
  kalman: KalmanConfig;
  gatingThreshold: number;     // Mahalanobis distance gate
  initThreshold: number;       // M-of-N: minimum detections
  initWindow: number;          // M-of-N: window size
  deleteThreshold: number;     // Max consecutive misses before deletion
  maxTracks: number;
}

export const DEFAULT_MT_CONFIG: MultiTargetConfig = {
  kalman: DEFAULT_KALMAN_CONFIG,
  gatingThreshold: 3.0,
  initThreshold: 3,
  initWindow: 5,
  deleteThreshold: 10,
  maxTracks: 20,
};

interface TrackCandidate {
  measurements: Measurement[];
  windowStart: number;
}

let nextTrackId = 1;

export class MultiTargetTracker {
  private tracks: TargetState[] = [];
  private candidates: TrackCandidate[] = [];
  private config: MultiTargetConfig;
  private frameCount = 0;

  constructor(config: MultiTargetConfig = DEFAULT_MT_CONFIG) {
    this.config = config;
  }

  getTracks(): TargetState[] {
    return this.tracks.slice();
  }

  step(measurements: Measurement[], dt: number): TargetState[] {
    this.frameCount++;

    // 1. Predict all tracks
    this.tracks = this.tracks.map(t => predict(t, dt, this.config.kalman));

    // 2. Associate measurements to tracks (nearest-neighbor gating)
    const assigned = new Set<number>();
    const unassigned: Measurement[] = [];

    for (const meas of measurements) {
      let bestTrackIdx = -1;
      let bestDist = Infinity;

      for (let t = 0; t < this.tracks.length; t++) {
        if (assigned.has(t)) continue;
        const dist = mahalanobisDistance(this.tracks[t], meas, this.config.kalman);
        if (dist < this.config.gatingThreshold && dist < bestDist) {
          bestDist = dist;
          bestTrackIdx = t;
        }
      }

      if (bestTrackIdx >= 0) {
        this.tracks[bestTrackIdx] = update(this.tracks[bestTrackIdx], meas, this.config.kalman);
        assigned.add(bestTrackIdx);
      } else {
        unassigned.push(meas);
      }
    }

    // 3. Track initiation (M-of-N logic)
    for (const meas of unassigned) {
      // Check if near an existing candidate
      let foundCandidate = false;
      for (const cand of this.candidates) {
        const lastMeas = cand.measurements[cand.measurements.length - 1];
        const dr = Math.abs(meas.range - lastMeas.range);
        const da = Math.abs(meas.angleDeg - lastMeas.angleDeg);
        if (dr < 0.5 && da < 15) {
          cand.measurements.push(meas);
          foundCandidate = true;
          break;
        }
      }
      if (!foundCandidate) {
        this.candidates.push({ measurements: [meas], windowStart: this.frameCount });
      }
    }

    // Promote candidates that meet M-of-N
    const promoted: TrackCandidate[] = [];
    this.candidates = this.candidates.filter(cand => {
      const age = this.frameCount - cand.windowStart;
      if (cand.measurements.length >= this.config.initThreshold) {
        promoted.push(cand);
        return false;
      }
      if (age >= this.config.initWindow) return false; // aged out
      return true;
    });

    for (const cand of promoted) {
      if (this.tracks.length >= this.config.maxTracks) break;
      const lastMeas = cand.measurements[cand.measurements.length - 1];
      const track = createTarget(nextTrackId++, lastMeas);
      this.tracks.push(track);
    }

    // 4. Track deletion (miss count threshold)
    this.tracks = this.tracks.filter(t => t.missCount < this.config.deleteThreshold);

    return this.getTracks();
  }

  reset(): void {
    this.tracks = [];
    this.candidates = [];
    this.frameCount = 0;
  }
}
