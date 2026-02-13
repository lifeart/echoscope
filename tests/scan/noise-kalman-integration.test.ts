import {
  createNoiseKalmanState,
  guardBackoff,
  subtractNoiseFloor,
  updateNoiseKalman,
} from '../../src/dsp/noise-floor-kalman.js';
import { createClutterState, suppressStaticReflections } from '../../src/dsp/clutter.js';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function maxValue(a: Float32Array): number {
  let m = -Infinity;
  for (let i = 0; i < a.length; i++) {
    if (a[i] > m) m = a[i];
  }
  return m;
}

describe('noise kalman integration (synthetic scan scene)', () => {
  it('reduces false high peaks in stationary-noise scene', () => {
    const bins = 72;
    const frames = 120;
    const rand = lcg(12345);

    const floor = new Float32Array(bins);
    for (let i = 0; i < bins; i++) {
      floor[i] = 0.14 + 0.02 * Math.sin((2 * Math.PI * i) / bins);
    }

    const kalman = createNoiseKalmanState(bins, 0.0);
    let clutter = createClutterState();

    let rawFalsePeaks = 0;
    let filteredFalsePeaks = 0;
    const threshold = 0.25;

    for (let t = 0; t < frames; t++) {
      const profile = new Float32Array(bins);
      for (let i = 0; i < bins; i++) {
        const noise = (rand() - 0.5) * 0.06;
        profile[i] = Math.max(0, floor[i] + noise);
      }

      if (t % 11 === 0) {
        const spikeBin = Math.floor(rand() * bins);
        profile[spikeBin] += 0.16 + 0.08 * rand();
      }

      if (maxValue(profile) > threshold) rawFalsePeaks++;

      updateNoiseKalman(kalman, profile, {
        q: 1e-5,
        r: 7e-4,
        minFloor: 0,
        maxFloor: 1,
      });

      const nk = subtractNoiseFloor(profile, kalman, 0.6, 0, 1);
      const nkSafe = guardBackoff(profile, nk, {
        enabled: true,
        collapseThreshold: 0.24,
        peakDropThreshold: 0.30,
      }).profile;

      const clutterOut = suppressStaticReflections(nkSafe, clutter, 0.65, {
        backoff: {
          enabled: true,
          collapseThreshold: 0.24,
          peakDropThreshold: 0.30,
        },
        selectiveUpdate: { enabled: true, noveltyRatio: 0.35 },
      });
      clutter = clutterOut.clutterState;

      if (maxValue(clutterOut.profile) > threshold) filteredFalsePeaks++;
    }

    expect(filteredFalsePeaks).toBeLessThan(rawFalsePeaks);
    expect(filteredFalsePeaks / Math.max(1, rawFalsePeaks)).toBeLessThan(0.75);
  });

  it('freeze-on-high-confidence preserves strong target energy', () => {
    const bins = 64;
    const kalman = createNoiseKalmanState(bins, 0.0);
    const targetBin = 20;

    for (let t = 0; t < 80; t++) {
      const p = new Float32Array(bins).fill(0.15);
      updateNoiseKalman(kalman, p, {
        q: 8e-6,
        r: 6e-4,
        minFloor: 0,
        maxFloor: 1,
      });
    }

    let retained = 0;
    for (let t = 0; t < 12; t++) {
      const p = new Float32Array(bins).fill(0.15);
      p[targetBin] = 0.9;

      updateNoiseKalman(kalman, p, {
        q: 8e-6,
        r: 6e-4,
        freeze: true,
        minFloor: 0,
        maxFloor: 1,
      });

      const out = subtractNoiseFloor(p, kalman, 0.55, 0, 1);
      retained = out[targetBin];
    }

    expect(retained).toBeGreaterThan(0.35);
  });
});
