import { store } from '../../src/core/store.js';
import { bus } from '../../src/core/event-bus.js';
import { resetTrackingState, updateTrackingFromMeasurement } from '../../src/tracking/engine.js';

describe('tracking runtime bridge', () => {
  beforeEach(() => {
    bus.clear();
    store.reset();
    resetTrackingState();
  });

  it('promotes repeated detections into store targets and emits updates', () => {
    const updates: number[] = [];
    bus.on('target:updated', tracks => {
      updates.push(tracks.length);
    });

    updateTrackingFromMeasurement({ range: 2.0, angleDeg: 10, strength: 0.8, timestamp: 1000 }, 1000);
    updateTrackingFromMeasurement({ range: 2.02, angleDeg: 11, strength: 0.82, timestamp: 1100 }, 1100);
    const tracks = updateTrackingFromMeasurement({ range: 1.98, angleDeg: 9, strength: 0.79, timestamp: 1200 }, 1200);

    expect(tracks.length).toBeGreaterThanOrEqual(1);
    expect(store.get().targets.length).toBeGreaterThanOrEqual(1);
    expect(updates.length).toBe(3);
    expect(updates[updates.length - 1]).toBeGreaterThanOrEqual(1);
  });

  it('ages out targets on repeated misses and clears store targets', () => {
    updateTrackingFromMeasurement({ range: 2.0, angleDeg: 10, strength: 0.8, timestamp: 1000 }, 1000);
    updateTrackingFromMeasurement({ range: 2.01, angleDeg: 10, strength: 0.81, timestamp: 1100 }, 1100);
    updateTrackingFromMeasurement({ range: 2.02, angleDeg: 9, strength: 0.8, timestamp: 1200 }, 1200);

    for (let i = 0; i < 12; i++) {
      updateTrackingFromMeasurement(null, 1300 + i * 100);
    }

    expect(store.get().targets.length).toBe(0);
  });
});
