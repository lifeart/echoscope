import { createHeatmap } from '../../src/scan/heatmap-data.js';
import { selectConsensusDirection } from '../../src/scan/scan-engine.js';

function writeRow(hm: ReturnType<typeof createHeatmap>, row: number, bins: number[], bestBin: number, bestVal: number): void {
  for (let i = 0; i < bins.length; i++) {
    hm.data[row * hm.bins + i] = bins[i];
  }
  hm.bestBin[row] = bestBin;
  hm.bestVal[row] = bestVal;
}

describe('scan-engine consensus selector', () => {
  it('rejects isolated strongest row when neighborhood is coherent elsewhere', () => {
    const hm = createHeatmap([-20, -10, 0, 10, 20], 8);

    writeRow(hm, 0, [0.02, 0.03, 0.05, 0.10, 0.32, 0.10, 0.03, 0.02], 4, 0.32);
    writeRow(hm, 1, [0.02, 0.03, 0.06, 0.12, 0.37, 0.12, 0.03, 0.02], 4, 0.37);
    writeRow(hm, 2, [0.02, 0.85, 0.03, 0.02, 0.02, 0.01, 0.01, 0.01], 1, 0.85);
    writeRow(hm, 3, [0.02, 0.03, 0.06, 0.11, 0.35, 0.11, 0.03, 0.02], 4, 0.35);
    writeRow(hm, 4, [0.01, 0.02, 0.04, 0.08, 0.30, 0.09, 0.02, 0.01], 4, 0.30);

    const result = selectConsensusDirection(hm, {
      strengthGate: 0.05,
      confidenceGate: 0.15,
      continuityBins: 1,
    });

    expect(result.row).not.toBe(2);
    expect(result.row).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeGreaterThan(0);
  });
});
