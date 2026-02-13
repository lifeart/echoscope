import { buildCandidateGrid, selectBestCarrierSubset } from '../../src/calibration/multiplex-carrier-selection.js';

describe('selectBestCarrierSubset', () => {
  it('selects top carriers with min-spacing constraint', () => {
    const result = selectBestCarrierSubset([
      { frequencyHz: 2300, snrDb: 10, psr: 4.5, stability: 0.9, detectRate: 1.0, score: 0.92 },
      { frequencyHz: 2450, snrDb: 9, psr: 4.0, stability: 0.8, detectRate: 1.0, score: 0.87 },
      { frequencyHz: 3200, snrDb: 8, psr: 3.5, stability: 0.8, detectRate: 0.9, score: 0.80 },
      { frequencyHz: 4200, snrDb: 7, psr: 3.2, stability: 0.75, detectRate: 0.9, score: 0.75 },
      { frequencyHz: 6200, snrDb: 6, psr: 2.9, stability: 0.7, detectRate: 0.8, score: 0.70 },
    ], 3, 200);

    expect(result.activeCarrierHz.length).toBe(3);
    for (let i = 1; i < result.activeCarrierHz.length; i++) {
      expect(result.activeCarrierHz[i] - result.activeCarrierHz[i - 1]).toBeGreaterThanOrEqual(200);
    }
    const wSum = result.carrierWeights.reduce((acc, value) => acc + value, 0);
    expect(Math.abs(wSum - 1)).toBeLessThan(1e-6);
  });

  it('falls back to at least one carrier when all scores are weak', () => {
    const result = selectBestCarrierSubset([
      { frequencyHz: 2100, snrDb: -15, psr: 1.01, stability: 0.05, detectRate: 0.1, score: 0.01 },
      { frequencyHz: 2800, snrDb: -12, psr: 1.02, stability: 0.08, detectRate: 0.0, score: 0.02 },
    ], 2, 180);

    expect(result.activeCarrierHz.length).toBeGreaterThanOrEqual(1);
    expect(result.candidates.some(c => c.selected)).toBe(true);
  });
});

describe('buildCandidateGrid', () => {
  it('clamps candidates to Nyquist-safe ceiling', () => {
    const grid = buildCandidateGrid({
      carrierCount: 6,
      fStart: 2000,
      fEnd: 12000,
      symbolMs: 8,
      guardHz: 180,
      minSpacingHz: 220,
      calibrationCandidates: 8,
      fusion: 'snrWeighted',
    }, 16000);

    expect(grid.length).toBe(8);
    expect(Math.max(...grid)).toBeLessThanOrEqual(16000 * 0.45 + 1e-6);
    expect(Math.min(...grid)).toBeGreaterThanOrEqual(800);
  });
});
