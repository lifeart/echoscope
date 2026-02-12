import { createHeatmap, updateHeatmapRow, smoothHeatmapDisplay } from '../../src/scan/heatmap-data.js';

describe('createHeatmap', () => {
  it('creates arrays with correct dimensions', () => {
    const angles = [-60, -30, 0, 30, 60];
    const bins = 240;
    const hm = createHeatmap(angles, bins);

    expect(hm.angles).toEqual(angles);
    expect(hm.bins).toBe(bins);
    expect(hm.data.length).toBe(5 * 240);
    expect(hm.display.length).toBe(5 * 240);
    expect(hm.bestBin.length).toBe(5);
    expect(hm.bestVal.length).toBe(5);
  });

  it('initializes all values to zero (bestBin to -1)', () => {
    const hm = createHeatmap([0, 10], 100);
    expect(hm.data.every(v => v === 0)).toBe(true);
    expect(hm.display.every(v => v === 0)).toBe(true);
    expect(hm.bestVal.every(v => v === 0)).toBe(true);
    for (let i = 0; i < hm.bestBin.length; i++) {
      expect(hm.bestBin[i]).toBe(-1);
    }
  });

  it('does not share angle array reference', () => {
    const angles = [0, 10, 20];
    const hm = createHeatmap(angles, 50);
    angles.push(30);
    expect(hm.angles).toEqual([0, 10, 20]);
  });
});

describe('updateHeatmapRow', () => {
  it('writes profile data into the correct row', () => {
    const hm = createHeatmap([0, 10, 20], 4);
    const profile = new Float32Array([0.1, 0.5, 0.9, 0.3]);

    updateHeatmapRow(hm, 1, profile, 2, 0.9);

    // Row 0 and 2 should still be zero
    for (let b = 0; b < 4; b++) {
      expect(hm.data[0 * 4 + b]).toBe(0);
      expect(hm.data[2 * 4 + b]).toBe(0);
    }
    // Row 1 should have profile values
    expect(hm.data[1 * 4 + 0]).toBeCloseTo(0.1);
    expect(hm.data[1 * 4 + 1]).toBeCloseTo(0.5);
    expect(hm.data[1 * 4 + 2]).toBeCloseTo(0.9);
    expect(hm.data[1 * 4 + 3]).toBeCloseTo(0.3);

    // Best bin/val
    expect(hm.bestBin[1]).toBe(2);
    expect(hm.bestVal[1]).toBeCloseTo(0.9);
  });

  it('applies decay and takes max with new data', () => {
    const hm = createHeatmap([0], 3);
    const profile1 = new Float32Array([1.0, 0.5, 0.2]);
    updateHeatmapRow(hm, 0, profile1, 0, 1.0);

    // Second update with decay=0.9
    const profile2 = new Float32Array([0.0, 0.8, 0.0]);
    updateHeatmapRow(hm, 0, profile2, 1, 0.8, 0.9);

    // Bin 0: max(1.0 * 0.9, 0.0) = 0.9
    expect(hm.data[0]).toBeCloseTo(0.9);
    // Bin 1: max(0.5 * 0.9, 0.8) = max(0.45, 0.8) = 0.8
    expect(hm.data[1]).toBeCloseTo(0.8);
    // Bin 2: max(0.2 * 0.9, 0.0) = 0.18
    expect(hm.data[2]).toBeCloseTo(0.18);
  });

  it('overwrites bestBin/bestVal for the row', () => {
    const hm = createHeatmap([0, 10], 4);
    updateHeatmapRow(hm, 0, new Float32Array(4), 2, 0.5);
    expect(hm.bestBin[0]).toBe(2);
    expect(hm.bestVal[0]).toBe(0.5);

    updateHeatmapRow(hm, 0, new Float32Array(4), -1, 0);
    expect(hm.bestBin[0]).toBe(-1);
    expect(hm.bestVal[0]).toBe(0);
  });
});

describe('smoothHeatmapDisplay', () => {
  it('moves display toward data with default alpha', () => {
    const hm = createHeatmap([0], 2);
    hm.data[0] = 1.0;
    hm.data[1] = 0.5;

    smoothHeatmapDisplay(hm);
    expect(hm.display[0]).toBeCloseTo(0.22);
    expect(hm.display[1]).toBeCloseTo(0.11);

    smoothHeatmapDisplay(hm);
    // display += 0.22 * (data - display) = 0.22 + 0.22*(1.0 - 0.22) = 0.22 + 0.1716
    expect(hm.display[0]).toBeCloseTo(0.3916);
  });

  it('converges to data after many iterations', () => {
    const hm = createHeatmap([0], 1);
    hm.data[0] = 0.75;

    for (let i = 0; i < 100; i++) smoothHeatmapDisplay(hm);
    expect(hm.display[0]).toBeCloseTo(0.75, 2);
  });

  it('preserves relative proportions after normalization', () => {
    const hm = createHeatmap([0], 3);
    hm.data[0] = 1.0;
    hm.data[1] = 0.5;
    hm.data[2] = 0.25;

    smoothHeatmapDisplay(hm);
    // After one step: display = alpha * data
    // Ratios: 1.0 : 0.5 : 0.25 preserved
    const mx = Math.max(hm.display[0], hm.display[1], hm.display[2]);
    expect(hm.display[0] / mx).toBeCloseTo(1.0);
    expect(hm.display[1] / mx).toBeCloseTo(0.5);
    expect(hm.display[2] / mx).toBeCloseTo(0.25);
  });
});
