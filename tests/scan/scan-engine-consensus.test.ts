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

    // Coherent rows: clean peaks at bin 4 with low sidelobe energy
    writeRow(hm, 0, [0.01, 0.01, 0.01, 0.05, 0.45, 0.05, 0.01, 0.01], 4, 0.45);
    writeRow(hm, 1, [0.01, 0.01, 0.01, 0.06, 0.50, 0.06, 0.01, 0.01], 4, 0.50);
    // Isolated row 2: strong but noisy peak at bin 1
    writeRow(hm, 2, [0.10, 0.85, 0.10, 0.08, 0.06, 0.08, 0.05, 0.05], 1, 0.85);
    writeRow(hm, 3, [0.01, 0.01, 0.01, 0.06, 0.48, 0.06, 0.01, 0.01], 4, 0.48);
    writeRow(hm, 4, [0.01, 0.01, 0.01, 0.04, 0.40, 0.04, 0.01, 0.01], 4, 0.40);

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
