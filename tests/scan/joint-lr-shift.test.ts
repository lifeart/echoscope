import { buildJointHeatmapFromLR } from '../../src/scan/joint-lr.js';

/**
 * Regression test: joint L/R heatmap must correctly apply differential
 * range shifts for left and right speakers.
 *
 * Geometry: L speaker at (-d/2, 0), R speaker at (d/2, 0).
 * A target at angle θ and true range R from the midpoint is at:
 *   r_L ≈ R + (d/2)·sinθ  (farther from L speaker)
 *   r_R ≈ R - (d/2)·sinθ  (closer to R speaker)
 *
 * So profileL peaks at a higher range bin, profileR peaks lower.
 * The joint heatmap must shift both profiles toward the true range
 * to align them when fusing.
 *
 * Bug: the code reads profileL[bin] (unshifted) and
 *   profileR[bin + shiftBins] (shifted wrong direction).
 * Correct: profileL[bin + shiftBins] and profileR[bin - shiftBins].
 */

function gaussianProfile(bins: number, peakBin: number, sigma: number, amplitude = 1e-4): Float32Array {
  const out = new Float32Array(bins);
  for (let i = 0; i < bins; i++) {
    const z = (i - peakBin) / sigma;
    out[i] = amplitude * Math.exp(-0.5 * z * z);
  }
  return out;
}

describe('buildJointHeatmapFromLR profile shift direction', () => {
  const bins = 240;
  const minRange = 0.3;
  const maxRange = 4.0;
  const binSize = (maxRange - minRange) / (bins - 1);
  const spacing = 0.24; // meters

  it('peak at broadside (0°) aligns at the same bin for L and R', () => {
    // At broadside, shiftBins = 0, so L and R peaks are at the same bin.
    const peakBin = 120;
    const pL = gaussianProfile(bins, peakBin, 3);
    const pR = gaussianProfile(bins, peakBin, 3);
    const angles = [0];

    const res = buildJointHeatmapFromLR({
      profileL: pL,
      profileR: pR,
      anglesDeg: angles,
      minRange,
      maxRange,
      speakerSpacingM: spacing,
      edgeMaskBins: 3,
    });

    // Peak should be at or very near the original bin
    expect(Math.abs(res.bestBin[0] - peakBin)).toBeLessThanOrEqual(1);
  });

  it('correctly fuses off-axis target at +30° with shifted L/R profiles', () => {
    // Target at true range R corresponding to bin 120, angle +30°
    // shift = (d/2)·sin(30°) = 0.12 * 0.5 = 0.06 m
    // shiftBins = 0.06 / binSize
    const trueBin = 120;
    const angleDeg = 30;
    const shiftRange = 0.5 * spacing * Math.sin(angleDeg * Math.PI / 180);
    const shiftBins = shiftRange / binSize;

    // profileL peaks at trueBin + shiftBins (L speaker is farther from target)
    // profileR peaks at trueBin - shiftBins (R speaker is closer to target)
    const pL = gaussianProfile(bins, trueBin + shiftBins, 3);
    const pR = gaussianProfile(bins, trueBin - shiftBins, 3);

    const angles = [-60, -30, 0, 30, 60];

    const res = buildJointHeatmapFromLR({
      profileL: pL,
      profileR: pR,
      anglesDeg: angles,
      minRange,
      maxRange,
      speakerSpacingM: spacing,
      edgeMaskBins: 3,
    });

    // The row for 30° should have the strongest fused peak
    const row30 = angles.indexOf(30);
    expect(res.bestVal[row30]).toBeGreaterThan(0);

    // The fused peak at 30° should be near the true bin (120),
    // NOT at the L peak (120 + shift) or the R peak (120 - shift)
    expect(Math.abs(res.bestBin[row30] - trueBin)).toBeLessThanOrEqual(2);

    // The 30° row should score higher than the 0° row for this target
    const row0 = angles.indexOf(0);
    expect(res.bestVal[row30]).toBeGreaterThan(res.bestVal[row0]);
  });

  it('correctly fuses off-axis target at -30° with shifted L/R profiles', () => {
    const trueBin = 120;
    const angleDeg = -30;
    const shiftRange = 0.5 * spacing * Math.sin(angleDeg * Math.PI / 180);
    const shiftBins = shiftRange / binSize;

    // profileL peaks at trueBin + shiftBins (negative shift for negative angle)
    // profileR peaks at trueBin - shiftBins (positive shift for negative angle)
    const pL = gaussianProfile(bins, trueBin + shiftBins, 3);
    const pR = gaussianProfile(bins, trueBin - shiftBins, 3);

    const angles = [-60, -30, 0, 30, 60];

    const res = buildJointHeatmapFromLR({
      profileL: pL,
      profileR: pR,
      anglesDeg: angles,
      minRange,
      maxRange,
      speakerSpacingM: spacing,
      edgeMaskBins: 3,
    });

    const rowNeg30 = angles.indexOf(-30);
    expect(res.bestVal[rowNeg30]).toBeGreaterThan(0);

    // Fused peak should still be near the true bin
    expect(Math.abs(res.bestBin[rowNeg30] - trueBin)).toBeLessThanOrEqual(2);

    // The -30° row should score higher than 0° for this target
    const row0 = angles.indexOf(0);
    expect(res.bestVal[rowNeg30]).toBeGreaterThan(res.bestVal[row0]);
  });

  it('strongly off-axis (45°) profiles misalign if shift is applied wrong', () => {
    const trueBin = 100;
    const angleDeg = 45;
    const shiftRange = 0.5 * spacing * Math.sin(angleDeg * Math.PI / 180);
    const shiftBins = shiftRange / binSize;

    // Narrow peaks make misalignment more obvious
    const pL = gaussianProfile(bins, trueBin + shiftBins, 2);
    const pR = gaussianProfile(bins, trueBin - shiftBins, 2);

    const angles = [-45, 0, 45];

    const res = buildJointHeatmapFromLR({
      profileL: pL,
      profileR: pR,
      anglesDeg: angles,
      minRange,
      maxRange,
      speakerSpacingM: spacing,
      edgeMaskBins: 3,
    });

    // The 45° row should have the strongest signal
    const row45 = angles.indexOf(45);
    const row0 = angles.indexOf(0);
    expect(res.bestVal[row45]).toBeGreaterThan(res.bestVal[row0]);

    // And the fused peak should be near the true bin
    expect(Math.abs(res.bestBin[row45] - trueBin)).toBeLessThanOrEqual(2);
  });
});
