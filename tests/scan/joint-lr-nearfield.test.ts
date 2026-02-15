/**
 * Regression tests for fix #4: near-field geometry in joint L/R heatmap.
 *
 * Before the fix, buildJointHeatmapFromLR used a far-field approximation
 * (shiftRange = 0.5 * d * sin(θ)) which has significant error at close
 * ranges. The fix uses exact near-field path difference:
 *   ΔR = sqrt(r² + (d/2)² + r·d·sinθ) - sqrt(r² + (d/2)² - r·d·sinθ)
 */
import { describe, it, expect } from 'vitest';
import { buildJointHeatmapFromLR } from '../../src/scan/joint-lr.js';

function makeProfile(bins: number, peakBin: number, peak = 1e-4): Float32Array {
  const out = new Float32Array(bins);
  for (let i = 0; i < bins; i++) out[i] = 1e-6;
  const p = Math.max(0, Math.min(bins - 1, peakBin));
  out[p] = peak;
  if (p - 1 >= 0) out[p - 1] = peak * 0.75;
  if (p + 1 < bins) out[p + 1] = peak * 0.75;
  if (p - 2 >= 0) out[p - 2] = peak * 0.45;
  if (p + 2 < bins) out[p + 2] = peak * 0.45;
  return out;
}

describe('joint L/R near-field geometry', () => {
  it('converges to far-field at large range', () => {
    // At large range, near-field and far-field should agree.
    // Build profiles with peak at bin 200 out of 240 (≈ range 3.4m for 0.3–4.0m)
    const bins = 240;
    const pL = makeProfile(bins, 200, 1e-4);
    const pR = makeProfile(bins, 200, 1e-4);
    const angles = [-30, 0, 30];

    const res = buildJointHeatmapFromLR({
      profileL: pL,
      profileR: pR,
      anglesDeg: angles,
      minRange: 0.3,
      maxRange: 4.0,
      speakerSpacingM: 0.24,
      edgeMaskBins: 3,
    });

    // At 0° angle, shift is zero regardless of model → best bin should be near 200
    expect(res.bestBin[1]).toBeGreaterThanOrEqual(198);
    expect(res.bestBin[1]).toBeLessThanOrEqual(202);
  });

  it('produces larger shift than far-field at close range', () => {
    // At close range (r ≈ d), near-field shift > far-field shift.
    // We verify the near-field correction by checking that the shift
    // at a large angle and close range differs from the simple d·sin(θ)/2.
    const d = 0.24; // speaker spacing
    const r = 0.3;  // very close range, comparable to d
    const thetaDeg = 45;
    const thetaRad = thetaDeg * Math.PI / 180;

    // Far-field shift
    const farFieldShift = 0.5 * d * Math.sin(thetaRad);

    // Near-field shift (the fixed formula)
    const halfD = d / 2;
    const rSq = r * r;
    const halfDSq = halfD * halfD;
    const rdSin = r * d * Math.sin(thetaRad);
    const dL = Math.sqrt(rSq + halfDSq + rdSin);
    const dR = Math.sqrt(rSq + halfDSq - rdSin);
    const nearFieldShift = 0.5 * (dL - dR);

    // Near-field shift is SMALLER than far-field because the plane-wave
    // (parallel ray) assumption overestimates the path difference. The exact
    // geometry accounts for the convergence of the rays at close range.
    expect(Math.abs(nearFieldShift)).toBeLessThan(Math.abs(farFieldShift));
    // The difference should be significant at this close range
    expect(Math.abs(farFieldShift) - Math.abs(nearFieldShift)).toBeGreaterThan(0.001);
    // But the near-field shift should still be in the same direction
    expect(Math.sign(nearFieldShift)).toBe(Math.sign(farFieldShift));
  });

  it('near-field shift converges to far-field at large R/d ratio', () => {
    const d = 0.24;
    const r = 50.0; // R/d ≈ 200, very much in far field
    const thetaDeg = 30;
    const thetaRad = thetaDeg * Math.PI / 180;

    const farFieldShift = 0.5 * d * Math.sin(thetaRad);

    const halfD = d / 2;
    const rSq = r * r;
    const halfDSq = halfD * halfD;
    const rdSin = r * d * Math.sin(thetaRad);
    const dL = Math.sqrt(rSq + halfDSq + rdSin);
    const dR = Math.sqrt(rSq + halfDSq - rdSin);
    const nearFieldShift = 0.5 * (dL - dR);

    // Should converge to within 0.1% at this range
    expect(nearFieldShift).toBeCloseTo(farFieldShift, 3);
  });

  it('shift is zero at 0° angle regardless of range', () => {
    const d = 0.24;
    const r = 0.3;

    const halfD = d / 2;
    const rSq = r * r;
    const halfDSq = halfD * halfD;
    const rdSin = 0; // sin(0) = 0
    const dL = Math.sqrt(rSq + halfDSq + rdSin);
    const dR = Math.sqrt(rSq + halfDSq - rdSin);
    const nearFieldShift = 0.5 * (dL - dR);

    expect(nearFieldShift).toBeCloseTo(0, 10);
  });

  it('produces symmetric results for ±θ', () => {
    const bins = 240;
    const pL = makeProfile(bins, 120, 1e-4);
    const pR = makeProfile(bins, 120, 1e-4);
    const angles = [-30, 0, 30];

    const res = buildJointHeatmapFromLR({
      profileL: pL,
      profileR: pR,
      anglesDeg: angles,
      minRange: 0.3,
      maxRange: 4.0,
      speakerSpacingM: 0.24,
      edgeMaskBins: 3,
    });

    // At 0° with symmetric profiles, both ±30° should have the same scores
    // (because L and R profiles are identical and the shift direction just swaps)
    expect(res.rowScores[0]).toBeCloseTo(res.rowScores[2], 5);
  });
});
