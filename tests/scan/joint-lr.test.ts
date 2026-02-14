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

describe('joint L/R heatmap', () => {
  it('favors prior-consistent range over stronger outlier', () => {
    const bins = 240;
    const pL = makeProfile(bins, 40, 1.2e-4);
    const pR = makeProfile(bins, 40, 1.1e-4);

    pL[6] = 1.4e-4;
    pR[6] = 1.4e-4;

    const angles = [-30, -20, -10, 0, 10, 20, 30];
    const res = buildJointHeatmapFromLR({
      profileL: pL,
      profileR: pR,
      anglesDeg: angles,
      minRange: 0.3,
      maxRange: 4.0,
      speakerSpacingM: 0.24,
      priorRangeM: 0.92,
      priorSigmaM: 0.25,
      edgeMaskBins: 3,
    });

    const centerRow = Math.floor(angles.length / 2);
    expect(res.bestBin[centerRow]).toBeGreaterThan(30);
    expect(res.bestBin[centerRow]).toBeLessThan(55);
  });

  it('applies angular shift between left/right profiles', () => {
    const bins = 240;
    const pL = makeProfile(bins, 120, 1e-4);
    const pR = makeProfile(bins, 128, 1e-4);
    const angles = [-60, 0, 60];

    const res = buildJointHeatmapFromLR({
      profileL: pL,
      profileR: pR,
      anglesDeg: angles,
      minRange: 0.3,
      maxRange: 4.0,
      speakerSpacingM: 0.24,
      edgeMaskBins: 3,
    });

    expect(res.rowScores[2]).toBeGreaterThan(res.rowScores[0]);
    expect(res.rowScores[0]).toBeGreaterThan(0);
    expect(res.rowScores[2]).toBeGreaterThan(0);
  });
});