import { srpPhatDOA, scanPeakDOA } from '../../src/spatial/doa.js';
import type { ArrayGeometry } from '../../src/types.js';

function makeGeometry(spacing: number, c: number): ArrayGeometry {
  return {
    speakers: [
      { x: -spacing / 2, y: 0, z: 0 },
      { x: spacing / 2, y: 0, z: 0 },
    ],
    microphones: [
      { x: -spacing / 2, y: 0, z: 0 },
      { x: spacing / 2, y: 0, z: 0 },
    ],
    spacing,
    speedOfSound: c,
  };
}

/** Deterministic PRNG for reproducible broadband noise */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

/**
 * Synthesize broadband noise arriving from a given angle.
 * Uses a base noise waveform delayed per-mic to simulate a plane wave.
 */
function synthesizeBroadband(
  angleDeg: number,
  geometry: ArrayGeometry,
  sampleRate: number,
  nSamples: number,
): Float32Array[] {
  const theta = angleDeg * Math.PI / 180;
  const c = geometry.speedOfSound;
  const mics = geometry.microphones;
  const centerX = mics.reduce((s, m) => s + m.x, 0) / mics.length;

  // Generate base noise (longer to allow shifting)
  const margin = 64;
  const rng = seededRandom(42);
  const base = new Float32Array(nSamples + 2 * margin);
  for (let i = 0; i < base.length; i++) base[i] = rng() * 2 - 1;

  return mics.map(mic => {
    const dx = mic.x - centerX;
    const delaySamples = -(dx * Math.sin(theta)) / c * sampleRate;
    const intDelay = Math.round(delaySamples);
    const ch = new Float32Array(nSamples);
    for (let i = 0; i < nSamples; i++) {
      const idx = margin + i - intDelay;
      if (idx >= 0 && idx < base.length) ch[i] = base[idx];
    }
    return ch;
  });
}

describe('srpPhatDOA', () => {
  const sr = 48000;
  const spacing = 0.245;
  const c = 343;
  const geo = makeGeometry(spacing, c);

  it('recovers 0° angle from broadside signal', () => {
    const channels = synthesizeBroadband(0, geo, sr, 4096);
    const result = srpPhatDOA(channels, geo, sr);
    expect(result.method).toBe('srp-phat');
    expect(Math.abs(result.azimuthDeg)).toBeLessThanOrEqual(2);
  });

  it('recovers positive angle', () => {
    const targetAngle = 25;
    const channels = synthesizeBroadband(targetAngle, geo, sr, 4096);
    const result = srpPhatDOA(channels, geo, sr, { minDeg: -60, maxDeg: 60, stepDeg: 1 });
    expect(Math.abs(result.azimuthDeg - targetAngle)).toBeLessThanOrEqual(3);
  });

  it('recovers negative angle', () => {
    const targetAngle = -30;
    const channels = synthesizeBroadband(targetAngle, geo, sr, 4096);
    const result = srpPhatDOA(channels, geo, sr, { minDeg: -60, maxDeg: 60, stepDeg: 1 });
    expect(Math.abs(result.azimuthDeg - targetAngle)).toBeLessThanOrEqual(3);
  });

  it('returns zero for single channel', () => {
    const ch = [new Float32Array(1024)];
    const result = srpPhatDOA(ch, geo, sr);
    expect(result.azimuthDeg).toBe(0);
    expect(result.confidence).toBe(0);
  });

  it('confidence is between 0 and 1', () => {
    const channels = synthesizeBroadband(10, geo, sr, 4096);
    const result = srpPhatDOA(channels, geo, sr);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

describe('scanPeakDOA', () => {
  it('finds angle with strongest peak', () => {
    const peaks = new Map<number, number>();
    peaks.set(-30, 0.2);
    peaks.set(-10, 0.5);
    peaks.set(0, 0.3);
    peaks.set(15, 0.9);
    peaks.set(30, 0.4);

    const result = scanPeakDOA(peaks);
    expect(result.azimuthDeg).toBe(15);
    expect(result.method).toBe('scan-peak');
    expect(result.confidence).toBeCloseTo(0.9, 5);
  });

  it('handles single entry', () => {
    const peaks = new Map<number, number>();
    peaks.set(42, 0.7);
    const result = scanPeakDOA(peaks);
    expect(result.azimuthDeg).toBe(42);
  });

  it('clamps confidence to [0, 1]', () => {
    const peaks = new Map<number, number>();
    peaks.set(0, 1.5);
    const result = scanPeakDOA(peaks);
    expect(result.confidence).toBe(1);
  });
});
