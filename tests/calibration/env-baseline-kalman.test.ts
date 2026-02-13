import { computeEnvBaseline } from '../../src/calibration/env-baseline.js';
import {
  createNoiseKalmanState,
  guardBackoff,
  subtractNoiseFloor,
  updateNoiseKalman,
} from '../../src/dsp/noise-floor-kalman.js';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1103515245 * s + 12345) & 0x7fffffff;
    return s / 0x80000000;
  };
}

function variance(a: Float32Array): number {
  if (a.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i];
  const mean = sum / a.length;
  let acc = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - mean;
    acc += d * d;
  }
  return acc / a.length;
}

describe('env baseline with kalman preprocessing', () => {
  it('filtered baseline is less biased by intermittent spikes', () => {
    const bins = 96;
    const pings = 28;
    const rand = lcg(77);

    const rawProfiles: Float32Array[] = [];
    const filteredProfiles: Float32Array[] = [];
    const kalman = createNoiseKalmanState(bins, 0);

    for (let t = 0; t < pings; t++) {
      const p = new Float32Array(bins);
      for (let i = 0; i < bins; i++) {
        const smoothFloor = 0.12 + 0.015 * Math.cos((2 * Math.PI * i) / bins);
        const noise = (rand() - 0.5) * 0.025;
        p[i] = Math.max(0, smoothFloor + noise);
      }

      if (t % 6 === 0) {
        p[18] += 0.55;
        p[51] += 0.45;
      }

      rawProfiles.push(p);

      updateNoiseKalman(kalman, p, {
        q: 1e-5,
        r: 8e-4,
        minFloor: 0,
        maxFloor: 1,
      });

      const nk = subtractNoiseFloor(p, kalman, 0.55, 0, 1);
      const safe = guardBackoff(p, nk, {
        enabled: true,
        collapseThreshold: 0.24,
        peakDropThreshold: 0.30,
      }).profile;
      filteredProfiles.push(safe);
    }

    const rawBaseline = computeEnvBaseline(rawProfiles, bins);
    const filteredBaseline = computeEnvBaseline(filteredProfiles, bins);

    expect(rawBaseline).not.toBeNull();
    expect(filteredBaseline).not.toBeNull();

    const raw = rawBaseline!;
    const filt = filteredBaseline!;

    // Spike bins should be less dominant after Kalman preprocessing.
    expect(filt[18]).toBeLessThan(raw[18]);
    expect(filt[51]).toBeLessThan(raw[51]);

    // Overall baseline should be smoother / less variant.
    expect(variance(filt)).toBeLessThan(variance(raw));
  });
});
