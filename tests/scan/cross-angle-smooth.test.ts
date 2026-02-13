import { describe, it, expect } from 'vitest';
import { crossAngleSmooth, createHeatmap } from '../../src/scan/heatmap-data.js';

describe('crossAngleSmooth', () => {
  it('removes isolated outlier angle (median of [0,1,0]=0)', () => {
    const hm = createHeatmap([-10, 0, 10], 4);
    const bins = hm.bins;

    // Set middle row (index 1), bin 2 to 1.0; other rows at that bin are 0
    hm.data[1 * bins + 2] = 1.0;

    crossAngleSmooth(hm);

    // Median of [0, 1, 0] = 0 -> outlier removed
    expect(hm.data[1 * bins + 2]).toBe(0);
  });

  it('preserves consistent signal across angles', () => {
    const hm = createHeatmap([-10, 0, 10], 4);
    const bins = hm.bins;

    // All 3 rows have value 0.8 at bin 1
    hm.data[0 * bins + 1] = 0.8;
    hm.data[1 * bins + 1] = 0.8;
    hm.data[2 * bins + 1] = 0.8;

    crossAngleSmooth(hm);

    // Median of [0.8, 0.8, 0.8] = 0.8 -> preserved
    expect(hm.data[0 * bins + 1]).toBeCloseTo(0.8);
    expect(hm.data[1 * bins + 1]).toBeCloseTo(0.8);
    expect(hm.data[2 * bins + 1]).toBeCloseTo(0.8);
  });

  it('handles <3 rows (no-op)', () => {
    const hm = createHeatmap([-10, 10], 4);
    const bins = hm.bins;

    hm.data[0 * bins + 0] = 0.5;
    hm.data[1 * bins + 0] = 0.7;

    const dataBefore = new Float32Array(hm.data);
    crossAngleSmooth(hm);

    // Data should be unchanged since rows < 3
    for (let i = 0; i < hm.data.length; i++) {
      expect(hm.data[i]).toBe(dataBefore[i]);
    }
  });

  it('radius=2 uses 5-point median', () => {
    const hm = createHeatmap([-20, -10, 0, 10, 20], 2);
    const bins = hm.bins;

    // Set all rows to 0 at bin 0, except middle row which is 1.0
    hm.data[0 * bins + 0] = 0;
    hm.data[1 * bins + 0] = 0;
    hm.data[2 * bins + 0] = 1.0; // outlier in middle
    hm.data[3 * bins + 0] = 0;
    hm.data[4 * bins + 0] = 0;

    crossAngleSmooth(hm, 2);

    // With radius=2, window for row 2 is [0, 0, 1, 0, 0] -> median = 0
    expect(hm.data[2 * bins + 0]).toBe(0);
  });

  it('updates bestBin/bestVal after processing', () => {
    const hm = createHeatmap([-10, 0, 10], 4);
    const bins = hm.bins;

    // Consistent signal at bin 3 across all rows
    hm.data[0 * bins + 3] = 0.9;
    hm.data[1 * bins + 3] = 0.9;
    hm.data[2 * bins + 3] = 0.9;

    crossAngleSmooth(hm);

    // bestBin should reflect the smoothed data
    for (let r = 0; r < 3; r++) {
      expect(hm.bestBin[r]).toBe(3);
      expect(hm.bestVal[r]).toBeCloseTo(0.9);
    }
  });

  it('resets display array', () => {
    const hm = createHeatmap([-10, 0, 10], 4);

    // Fill display with non-zero values
    hm.display.fill(0.5);

    crossAngleSmooth(hm);

    // Display should be all zeros after smooth
    for (let i = 0; i < hm.display.length; i++) {
      expect(hm.display[i]).toBe(0);
    }
  });

  it('idempotent on already-smooth data', () => {
    const hm = createHeatmap([-10, 0, 10], 4);
    const bins = hm.bins;

    // Set a uniform pattern that the median filter won't change
    for (let r = 0; r < 3; r++) {
      hm.data[r * bins + 0] = 0.2;
      hm.data[r * bins + 1] = 0.5;
      hm.data[r * bins + 2] = 0.8;
      hm.data[r * bins + 3] = 0.3;
    }

    crossAngleSmooth(hm);
    const afterFirst = new Float32Array(hm.data);

    crossAngleSmooth(hm);
    const afterSecond = new Float32Array(hm.data);

    // Second smooth should produce the same result as the first
    for (let i = 0; i < afterFirst.length; i++) {
      expect(afterSecond[i]).toBeCloseTo(afterFirst[i]);
    }
  });
});
