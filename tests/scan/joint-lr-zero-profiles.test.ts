import { describe, it, expect } from 'vitest';
import { buildJointHeatmapFromLR } from '../../src/scan/joint-lr.js';

/**
 * Tests for joint L/R heatmap behavior with zero/near-zero profiles.
 *
 * The geometric mean sqrt(L*R) ensures that noise on only one side
 * produces zero output. This is the key property that, combined with
 * the L/R profile energy gate, prevents muted-speaker false detections.
 */

function makeProfile(bins: number, peakBin: number, peak = 1e-4): Float32Array {
  const out = new Float32Array(bins);
  for (let i = 0; i < bins; i++) out[i] = 1e-6;
  const p = Math.max(0, Math.min(bins - 1, peakBin));
  out[p] = peak;
  if (p - 1 >= 0) out[p - 1] = peak * 0.75;
  if (p + 1 < bins) out[p + 1] = peak * 0.75;
  return out;
}

const DEFAULT_PARAMS = {
  anglesDeg: [-30, -15, 0, 15, 30],
  minRange: 0.3,
  maxRange: 4.0,
  speakerSpacingM: 0.24,
  edgeMaskBins: 2,
};

describe('joint L/R heatmap: zero profile handling', () => {
  it('zero L profile → all-zero output', () => {
    const bins = 100;
    const profileL = new Float32Array(bins); // all zeros
    const profileR = makeProfile(bins, 50, 1e-3);

    const result = buildJointHeatmapFromLR({
      ...DEFAULT_PARAMS,
      profileL,
      profileR,
    });

    // Geometric mean: sqrt(0 * R) = 0 everywhere
    for (let i = 0; i < result.data.length; i++) {
      expect(result.data[i]).toBe(0);
    }
    for (let row = 0; row < DEFAULT_PARAMS.anglesDeg.length; row++) {
      expect(result.bestVal[row]).toBe(0);
    }
  });

  it('zero R profile → all-zero output', () => {
    const bins = 100;
    const profileL = makeProfile(bins, 50, 1e-3);
    const profileR = new Float32Array(bins); // all zeros

    const result = buildJointHeatmapFromLR({
      ...DEFAULT_PARAMS,
      profileL,
      profileR,
    });

    for (let i = 0; i < result.data.length; i++) {
      expect(result.data[i]).toBe(0);
    }
    for (let row = 0; row < DEFAULT_PARAMS.anglesDeg.length; row++) {
      expect(result.bestVal[row]).toBe(0);
    }
  });

  it('both zero profiles → all-zero output', () => {
    const bins = 100;
    const result = buildJointHeatmapFromLR({
      ...DEFAULT_PARAMS,
      profileL: new Float32Array(bins),
      profileR: new Float32Array(bins),
    });

    expect(result.data.every(v => v === 0)).toBe(true);
    expect(result.bestVal.every(v => v === 0)).toBe(true);
  });

  it('both profiles with peak at same bin → non-zero output', () => {
    const bins = 100;
    const profileL = makeProfile(bins, 50, 1e-3);
    const profileR = makeProfile(bins, 50, 1e-3);

    const result = buildJointHeatmapFromLR({
      ...DEFAULT_PARAMS,
      profileL,
      profileR,
    });

    // At least one row should have non-zero bestVal
    let maxBestVal = 0;
    for (let row = 0; row < DEFAULT_PARAMS.anglesDeg.length; row++) {
      if (result.bestVal[row] > maxBestVal) maxBestVal = result.bestVal[row];
    }
    expect(maxBestVal).toBeGreaterThan(0);
  });

  it('geometric mean property: sqrt(L*R) where one is zero → zero', () => {
    const bins = 50;
    const profileL = new Float32Array(bins);
    const profileR = new Float32Array(bins);

    // L has peak at bin 25, R has peak at bin 30 (no overlap)
    profileL[25] = 0.01;
    profileR[30] = 0.01;

    const result = buildJointHeatmapFromLR({
      ...DEFAULT_PARAMS,
      profileL,
      profileR,
    });

    // At bin 25, R is 0 → fused = 0
    // At bin 30, L is 0 → fused = 0
    // All output should be zero (or near-zero from interpolation)
    for (let row = 0; row < DEFAULT_PARAMS.anglesDeg.length; row++) {
      expect(result.bestVal[row]).toBeLessThan(1e-6);
    }
  });
});

describe('joint L/R heatmap: edge masking', () => {
  it('masks edge bins', () => {
    const bins = 100;
    const edgeMaskBins = 5;
    // Place peak in edge zone
    const profileL = new Float32Array(bins);
    const profileR = new Float32Array(bins);
    profileL[2] = 0.05; // within edge mask
    profileR[2] = 0.05;
    profileL[97] = 0.05; // within edge mask (tail)
    profileR[97] = 0.05;
    profileL[50] = 0.01; // safe zone
    profileR[50] = 0.01;

    const result = buildJointHeatmapFromLR({
      ...DEFAULT_PARAMS,
      profileL,
      profileR,
      edgeMaskBins,
    });

    // Edge bins should be zero
    const centerRow = 2; // row for angle=0
    for (let b = 0; b < edgeMaskBins; b++) {
      expect(result.data[centerRow * bins + b]).toBe(0);
    }
    for (let b = bins - edgeMaskBins; b < bins; b++) {
      expect(result.data[centerRow * bins + b]).toBe(0);
    }
  });
});

describe('joint L/R heatmap: bestBin/bestVal tracking', () => {
  it('bestBin[row] = -1 and bestVal[row] = 0 when all bins masked/zero', () => {
    const bins = 10;
    const result = buildJointHeatmapFromLR({
      ...DEFAULT_PARAMS,
      profileL: new Float32Array(bins),
      profileR: new Float32Array(bins),
      edgeMaskBins: 0,
    });

    for (let row = 0; row < DEFAULT_PARAMS.anglesDeg.length; row++) {
      expect(result.bestBin[row]).toBe(-1);
      expect(result.bestVal[row]).toBe(0);
    }
  });

  it('rowScores match bestVal', () => {
    const bins = 100;
    const profileL = makeProfile(bins, 50, 1e-3);
    const profileR = makeProfile(bins, 50, 1e-3);

    const result = buildJointHeatmapFromLR({
      ...DEFAULT_PARAMS,
      profileL,
      profileR,
    });

    for (let row = 0; row < DEFAULT_PARAMS.anglesDeg.length; row++) {
      expect(result.rowScores[row]).toBe(result.bestVal[row]);
    }
  });
});
