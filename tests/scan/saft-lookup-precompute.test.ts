/**
 * Regression tests for fix #10: SAFT lookup precomputation.
 *
 * Before the fix, getFrameForRow rebuilt the full row-frame lookup
 * on every call, causing O(n²) behavior. That function has been removed
 * and buildRowFrameLookup is now exported for explicit precomputation.
 * coherentSumCell uses a default parameter that precomputes once if
 * no lookup is provided.
 */
import { describe, it, expect } from 'vitest';
import {
  buildRowFrameLookup,
  coherentSumCell,
  buildSaftHeatmap,
} from '../../src/scan/saft.js';
import type { RawAngleFrame, SaftConfig } from '../../src/types.js';

function makeConfig(overrides?: Partial<SaftConfig>): SaftConfig {
  return {
    enabled: true,
    halfWindow: 2,
    window: 'hann',
    phaseCenterHz: 4000,
    coherenceFloor: 0,
    maxTauShiftSamples: 256,
    ...overrides,
  };
}

function makeFrame(angleDeg: number, len = 512, sampleRate = 48000): RawAngleFrame {
  const corrReal = new Float32Array(len);
  const corrImag = new Float32Array(len);
  // Place peak at a sample corresponding to range 0.3m
  // tau = 2*R/c = 2*0.3/343 ≈ 0.00175s → sample ≈ 0.00175*48000 ≈ 84
  const peakSample = 84;
  for (let i = 0; i < len; i++) {
    const d = i - peakSample;
    corrReal[i] = Math.exp(-0.5 * d * d / 9);
  }
  return {
    angleDeg,
    sampleRate,
    tau0: 0,
    corrReal,
    corrImag,
    centerFreqHz: 4000,
    quality: 0.9,
  };
}

describe('SAFT lookup precomputation', () => {
  it('buildRowFrameLookup returns correct frame for each angle', () => {
    const angles = [-10, 0, 10];
    const frames = angles.map(a => makeFrame(a));
    const lookup = buildRowFrameLookup(frames, angles);

    expect(lookup.length).toBe(3);
    for (let i = 0; i < angles.length; i++) {
      expect(lookup[i]).not.toBeNull();
      expect(lookup[i]!.angleDeg).toBe(angles[i]);
    }
  });

  it('buildRowFrameLookup handles missing frames', () => {
    const angles = [-10, 0, 10, 20];
    // Only provide frames for a subset
    const frames = [makeFrame(-10), makeFrame(10)];
    const lookup = buildRowFrameLookup(frames, angles);

    expect(lookup.length).toBe(4);
    expect(lookup[0]).not.toBeNull();
    expect(lookup[0]!.angleDeg).toBe(-10);
    // 0° and 20° have no matching frame
    expect(lookup[1]).toBeNull();
    expect(lookup[2]).not.toBeNull();
    expect(lookup[2]!.angleDeg).toBe(10);
    expect(lookup[3]).toBeNull();
  });

  it('coherentSumCell works with precomputed lookup', () => {
    const angles = [-10, 0, 10];
    const frames = angles.map(a => makeFrame(a));
    const lookup = buildRowFrameLookup(frames, angles);
    const cfg = makeConfig({ halfWindow: 1 });

    const result = coherentSumCell(1, 0.3, frames, angles, cfg, 0.2, 343, lookup);
    expect(result.intensity).toBeGreaterThan(0);
  });

  it('coherentSumCell auto-builds lookup when not provided', () => {
    const angles = [-10, 0, 10];
    const frames = angles.map(a => makeFrame(a));
    const cfg = makeConfig({ halfWindow: 1 });

    // Without explicit lookup (tests the default parameter)
    const result = coherentSumCell(1, 0.3, frames, angles, cfg, 0.2, 343);
    expect(result.intensity).toBeGreaterThan(0);
  });

  it('buildSaftHeatmap precomputes lookup internally', () => {
    const angles = [-10, 0, 10];
    const frames = angles.map(a => makeFrame(a));

    const result = buildSaftHeatmap({
      rawFrames: frames,
      scanAngles: angles,
      minRange: 0.1,
      maxRange: 1.0,
      bins: 20,
      spacing: 0.2,
      speedOfSound: 343,
      config: makeConfig({ halfWindow: 1 }),
    });

    expect(result.data.length).toBe(3 * 20);
    // Should have some non-zero values
    let hasNonZero = false;
    for (let i = 0; i < result.data.length; i++) {
      if (result.data[i] > 0) { hasNonZero = true; break; }
    }
    expect(hasNonZero).toBe(true);
  });
});
