import { createHeatmap, updateHeatmapRow } from '../../src/scan/heatmap-data.js';

describe('temporal IIR in heatmap data path', () => {
  it('accumulates weak target energy across updates', () => {
    const hm = createHeatmap([0], 4);
    const weak = new Float32Array([0.01, 0.02, 0.12, 0.02]);

    for (let i = 0; i < 6; i++) {
      updateHeatmapRow(hm, 0, weak, 2, 0.12, { temporalIirAlpha: 0.2, decayFactor: 1.0 });
    }

    expect(hm.data[2]).toBeGreaterThan(0.08);
    expect(hm.data[2]).toBeLessThan(0.12);
    expect(hm.bestBin[0]).toBe(2);
    expect(hm.bestVal[0]).toBeCloseTo(hm.data[2], 6);
  });

  it('remains responsive to new peaks while smoothing', () => {
    const hm = createHeatmap([0], 5);
    updateHeatmapRow(hm, 0, new Float32Array([0.05, 0.07, 0.30, 0.07, 0.05]), 2, 0.30, { temporalIirAlpha: 0.2, decayFactor: 1.0 });
    updateHeatmapRow(hm, 0, new Float32Array([0.05, 0.31, 0.08, 0.06, 0.05]), 1, 0.31, { temporalIirAlpha: 0.6, decayFactor: 1.0 });

    expect(hm.bestBin[0]).toBe(1);
    expect(hm.data[1]).toBeGreaterThan(hm.data[2]);
  });
});
