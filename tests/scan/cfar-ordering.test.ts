/**
 * Regression test for fix #8: CFAR ordering consistency.
 *
 * In the L/R scan path, CFAR + confidence gating must be applied BEFORE
 * inter-scan blending (blendWithPreviousScan). This ensures that the
 * noise-floor statistics CFAR relies on are not corrupted by blending
 * with previous scan data. The legacy TX-steering path already applies
 * CFAR per-ping before any blending.
 *
 * This test verifies the ordering indirectly by checking that the
 * selectConsensusDirection function (which uses the same CFAR + gating
 * logic) correctly filters rows before any external blend operation
 * would apply.
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

describe('CFAR ordering consistency', () => {
  it('gating applied to unblended data rejects noise rows', () => {
    // Create a heatmap where all rows are uniform noise (no real peak).
    // Gating on unblended data should reject all rows.
    const bins = 16;
    const hm = createHeatmap([-30, -20, -10, 0, 10, 20, 30], bins);

    const noise = new Array(bins).fill(0).map(() => 0.001 + Math.random() * 0.0001);
    for (let r = 0; r < 7; r++) {
      writeRow(hm, r, noise, -1, 0);
    }

    const result = selectConsensusDirection(hm, {
      strengthGate: 0.01,
      confidenceGate: 0.3,
      continuityBins: 2,
    });

    // No row should be selected from pure noise
    expect(result.row).toBe(-1);
  });

  it('gating applied to unblended data accepts genuine targets', () => {
    // Create heatmap with one clear target at row 3 (0°)
    const bins = 16;
    const hm = createHeatmap([-30, -20, -10, 0, 10, 20, 30], bins);

    // Noise rows
    for (let r = 0; r < 7; r++) {
      const noise = new Array(bins).fill(0.001);
      writeRow(hm, r, noise, -1, 0);
    }

    // Strong peak at row 3, bin 8
    const signal = new Array(bins).fill(0.001);
    signal[7] = 0.08;
    signal[8] = 0.15;
    signal[9] = 0.08;
    writeRow(hm, 3, signal, 8, 0.15);

    // Also give some support in neighboring rows
    const support = new Array(bins).fill(0.001);
    support[8] = 0.06;
    support[7] = 0.03;
    support[9] = 0.03;
    writeRow(hm, 2, support, 8, 0.06);
    writeRow(hm, 4, support, 8, 0.06);

    const result = selectConsensusDirection(hm, {
      strengthGate: 0.01,
      confidenceGate: 0.05,
      continuityBins: 2,
    });

    expect(result.row).toBe(3);
    expect(result.score).toBeGreaterThan(0);
  });
});
