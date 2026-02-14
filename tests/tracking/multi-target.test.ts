import { MultiTargetTracker } from '../../src/tracking/multi-target.js';
import type { Measurement } from '../../src/types.js';

describe('MultiTargetTracker', () => {
  it('initiates track after M-of-N detections', () => {
    const tracker = new MultiTargetTracker({
      kalman: {
        processNoiseRange: 0.01,
        processNoiseAngle: 1.0,
        measurementNoiseRange: 0.05,
        measurementNoiseAngle: 2.0,
      },
      gatingThreshold: 5.0,
      initThreshold: 2,
      initWindow: 5,
      deleteThreshold: 10,
      maxTracks: 20,
    });

    const meas: Measurement = { range: 2.0, angleDeg: 0, strength: 0.8, timestamp: 0 };

    // First detection - should create candidate
    let tracks = tracker.step([meas], 0.1);
    expect(tracks.length).toBe(0);

    // Second detection near same location - should promote to track
    const meas2: Measurement = { range: 2.05, angleDeg: 1, strength: 0.7, timestamp: 0.1 };
    tracks = tracker.step([meas2], 0.1);
    expect(tracks.length).toBe(1);
  });

  it('deletes tracks after too many misses', () => {
    const tracker = new MultiTargetTracker({
      kalman: {
        processNoiseRange: 0.01,
        processNoiseAngle: 1.0,
        measurementNoiseRange: 0.05,
        measurementNoiseAngle: 2.0,
      },
      gatingThreshold: 5.0,
      initThreshold: 1,
      initWindow: 2,
      deleteThreshold: 3,
      maxTracks: 20,
    });

    const meas: Measurement = { range: 2.0, angleDeg: 0, strength: 0.8, timestamp: 0 };
    tracker.step([meas], 0.1);

    // No measurements for several steps
    for (let i = 0; i < 5; i++) {
      tracker.step([], 0.1);
    }

    expect(tracker.getTracks().length).toBe(0);
  });

  it('initiates track with moderate range jitter', () => {
    const tracker = new MultiTargetTracker();

    const meas1: Measurement = { range: 0.3, angleDeg: 0, strength: 0.8, timestamp: 0 };
    const meas2: Measurement = { range: 1.12, angleDeg: 0, strength: 0.7, timestamp: 0.1 };

    let tracks = tracker.step([meas1], 0.1);
    expect(tracks.length).toBe(0);

    tracks = tracker.step([meas2], 0.1);
    expect(tracks.length).toBe(1);
  });
});
