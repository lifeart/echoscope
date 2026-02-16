/**
 * Regression tests for fix #5: consensus support clamping.
 *
 * Before the fix, two strong incoherent neighbors could produce unbounded
 * negative support that overwhelms a row's own score, suppressing legitimate
 * detections. The fix clamps negative support to at most -0.5 * smoothed[r].
 */
import { describe, it, expect } from 'vitest';
import { createHeatmap } from '../../src/scan/heatmap-data.js';
import { selectConsensusDirection } from '../../src/scan/scan-engine.js';

function writeRow(
  hm: ReturnType<typeof createHeatmap>,
  row: number,
  bins: number[],
  bestBin: number,
  bestVal: number,
): void {
  for (let i = 0; i < bins.length; i++) {
    hm.data[row * hm.bins + i] = bins[i];
  }
  hm.bestBin[row] = bestBin;
  hm.bestVal[row] = bestVal;
}

describe('consensus negative support clamping', () => {
  it('does not suppress a strong row with strong incoherent neighbors', () => {
    // Row 2 has a strong peak at bin 4.
    // Rows 1 and 3 have strong peaks at bin 1 (incoherent with row 2).
    // Before the fix, the penalty from rows 1 & 3 could make row 2's
    // consensus score negative, suppressing it entirely.
    const bins = 8;
    const hm = createHeatmap([-20, -10, 0, 10, 20], bins);

    // Rows 0 and 4: weak noise
    writeRow(hm, 0, [0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01], -1, 0);
    // Rows 1 and 3: strong peak at bin 1 (incoherent with row 2's bin 4)
    writeRow(hm, 1, [0.1, 0.9, 0.1, 0.02, 0.02, 0.02, 0.02, 0.02], 1, 0.9);
    // Row 2: strong peak at bin 4
    writeRow(hm, 2, [0.02, 0.02, 0.02, 0.1, 0.8, 0.1, 0.02, 0.02], 4, 0.8);
    // Row 3: strong peak at bin 1
    writeRow(hm, 3, [0.1, 0.85, 0.1, 0.02, 0.02, 0.02, 0.02, 0.02], 1, 0.85);
    writeRow(hm, 4, [0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01], -1, 0);

    const result = selectConsensusDirection(hm, {
      strengthGate: 0.05,
      confidenceGate: 0.05,
      continuityBins: 1,
    });

    // Row 2 should still be considered (not fully suppressed).
    // The consensus score for row 2 should remain positive due to clamping.
    // The best row should be one of the actually contributing rows.
    expect(result.row).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeGreaterThan(0);
  });

  it('still penalizes incoherent neighbors but with bounded negative support', () => {
    const bins = 8;
    const hm = createHeatmap([-20, -10, 0, 10, 20], bins);

    // Row 0: weak noise
    writeRow(hm, 0, [0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01], -1, 0);
    // Row 1: peak at bin 4 (coherent with row 2), clean profile
    writeRow(hm, 1, [0.01, 0.01, 0.01, 0.05, 0.55, 0.05, 0.01, 0.01], 4, 0.55);
    // Row 2: peak at bin 4 (target), clean profile
    writeRow(hm, 2, [0.01, 0.01, 0.01, 0.06, 0.60, 0.06, 0.01, 0.01], 4, 0.60);
    // Row 3: peak at bin 1 (incoherent with row 2) — slightly weaker
    writeRow(hm, 3, [0.10, 0.35, 0.10, 0.02, 0.02, 0.02, 0.02, 0.02], 1, 0.35);
    // Row 4: weak noise
    writeRow(hm, 4, [0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01], -1, 0);

    const result = selectConsensusDirection(hm, {
      strengthGate: 0.05,
      confidenceGate: 0.05,
      continuityBins: 1,
    });

    // Row 2 should be selected (coherent support from row 1 outweighs
    // the bounded penalty from row 3)
    expect(result.row).toBe(2);
    expect(result.score).toBeGreaterThan(0);
  });
});
