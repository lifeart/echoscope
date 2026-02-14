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
  initThreshold: 2,
  initWindow: 8,
  deleteThreshold: 10,
  maxTracks: 20,
};

const INIT_ASSOCIATION_GATE_SCALE = 1.25;

interface TrackCandidate {
  measurements: Measurement[];
  windowStart: number;
}

export class MultiTargetTracker {
  private tracks: TargetState[] = [];
  private candidates: TrackCandidate[] = [];
  private config: MultiTargetConfig;
  private frameCount = 0;
  private nextTrackId = 1;

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

    // 2. Associate measurements to tracks (sorted nearest-neighbor gating)
    const assignedTracks = new Set<number>();
    const assignedMeas = new Set<number>();
    const unassigned: Measurement[] = [];

    // Build all gated (measurement, track) pairs and sort by distance
    const candidates: Array<{ mi: number; ti: number; dist: number }> = [];
    for (let mi = 0; mi < measurements.length; mi++) {
      for (let ti = 0; ti < this.tracks.length; ti++) {
        const dist = mahalanobisDistance(this.tracks[ti], measurements[mi], this.config.kalman);
        if (dist < this.config.gatingThreshold) {
          candidates.push({ mi, ti, dist });
        }
      }
    }
    candidates.sort((a, b) => a.dist - b.dist);

    for (const { mi, ti } of candidates) {
      if (assignedTracks.has(ti) || assignedMeas.has(mi)) continue;
      this.tracks[ti] = update(this.tracks[ti], measurements[mi], this.config.kalman);
      assignedTracks.add(ti);
      assignedMeas.add(mi);
    }

    for (let mi = 0; mi < measurements.length; mi++) {
      if (!assignedMeas.has(mi)) unassigned.push(measurements[mi]);
    }

    // 3. Track initiation (M-of-N logic)
    for (const meas of unassigned) {
      // Check if near an existing candidate
      let foundCandidate = false;
      for (const cand of this.candidates) {
        const lastMeas = cand.measurements[cand.measurements.length - 1];
        const pseudoTrack = createTarget(-1, lastMeas);
        const md = mahalanobisDistance(pseudoTrack, meas, this.config.kalman);
        const initGate = this.config.gatingThreshold * INIT_ASSOCIATION_GATE_SCALE;
        if (md < initGate) {
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
      const track = createTarget(this.nextTrackId++, lastMeas);
      this.tracks.push(track);
    }

    // 4. Track deletion (miss count threshold)
    this.tracks = this.tracks.filter(t => t.missCount < this.config.deleteThreshold);

    // Reset ID counter when all tracks are dropped to prevent unbounded growth
    if (this.tracks.length === 0 && this.candidates.length === 0) {
      this.nextTrackId = 1;
    }

    return this.getTracks();
  }

  reset(): void {
    this.tracks = [];
    this.candidates = [];
    this.frameCount = 0;
    this.nextTrackId = 1;
  }
}
