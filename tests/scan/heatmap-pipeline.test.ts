import { createHeatmap, updateHeatmapRow, smoothHeatmapDisplay } from '../../src/scan/heatmap-data.js';

/**
 * Regression tests for the heatmap data pipeline with weak signals.
 *
 * Bug: The heatmap showed no data because:
 * 1. envBaseline zeroed out the profile
 * 2. Even after fixing that, the display array needs smoothing
 * 3. The hasData check (displayMax > 1e-12) must pass for rendering
 *
 * These tests verify the full pipeline: updateHeatmapRow → smoothHeatmapDisplay
 * works with realistic weak signal levels.
 */
describe('heatmap pipeline with weak signals', () => {
  it('end-to-end: weak signal appears in display after update + smooth', () => {
    const hm = createHeatmap([-60, 0, 60], 240);

    // Simulate a weak ping profile (typical real-world values)
    const profile = new Float32Array(240);
    profile[100] = 2.5e-4;
    profile[101] = 1.8e-4;
    profile[102] = 1.0e-4;
    // Add noise floor
    for (let i = 0; i < 240; i++) {
      if (!profile[i]) profile[i] = 1e-6;
    }

    // Update row for angle 0 (index 1)
    updateHeatmapRow(hm, 1, profile, 100, 2.5e-4);

    // Verify data was written
    expect(hm.data[1 * 240 + 100]).toBeCloseTo(2.5e-4);
    expect(hm.data[1 * 240 + 101]).toBeCloseTo(1.8e-4);

    // Smooth display
    smoothHeatmapDisplay(hm);

    // Display should now have non-zero values
    const displayMax = Math.max(...hm.display);
    expect(displayMax).toBeGreaterThan(1e-12); // hasData check passes

    // Verify display at the peak
    // display = 0 + 0.22 * (2.5e-4 - 0) = 5.5e-5
    expect(hm.display[1 * 240 + 100]).toBeCloseTo(5.5e-5, 8);
  });

  it('display reaches data after repeated smoothing', () => {
    const hm = createHeatmap([0], 4);
    const profile = new Float32Array([3e-5, 6e-5, 1e-5, 2e-5]);
    updateHeatmapRow(hm, 0, profile, 1, 6e-5);

    for (let i = 0; i < 100; i++) smoothHeatmapDisplay(hm);

    // After many iterations, display should converge to data
    expect(hm.display[0]).toBeCloseTo(3e-5, 8);
    expect(hm.display[1]).toBeCloseTo(6e-5, 8);
    expect(hm.display[2]).toBeCloseTo(1e-5, 8);
    expect(hm.display[3]).toBeCloseTo(2e-5, 8);
  });

  it('multiple rows are independent', () => {
    const hm = createHeatmap([-60, -30, 0, 30, 60], 10);

    const profile1 = new Float32Array(10);
    profile1[3] = 5e-4;
    updateHeatmapRow(hm, 1, profile1, 3, 5e-4);

    const profile2 = new Float32Array(10);
    profile2[7] = 8e-4;
    updateHeatmapRow(hm, 3, profile2, 7, 8e-4);

    smoothHeatmapDisplay(hm);

    // Row 1 peak at bin 3
    expect(hm.display[1 * 10 + 3]).toBeGreaterThan(0);
    // Row 3 peak at bin 7
    expect(hm.display[3 * 10 + 7]).toBeGreaterThan(0);
    // Row 0, 2, 4 should be zero
    expect(hm.display[0 * 10 + 3]).toBe(0);
    expect(hm.display[2 * 10 + 5]).toBe(0);
    expect(hm.display[4 * 10 + 7]).toBe(0);
  });

  it('bestBin=-1 does not corrupt data array', () => {
    const hm = createHeatmap([0, 10], 4);
    const profile = new Float32Array([1e-5, 3e-5, 2e-5, 1e-5]);

    // bestBin=-1 means "weak" detection, but data should still be stored
    updateHeatmapRow(hm, 0, profile, -1, 0);

    expect(hm.data[0]).toBeCloseTo(1e-5);
    expect(hm.data[1]).toBeCloseTo(3e-5);
    expect(hm.data[2]).toBeCloseTo(2e-5);
    expect(hm.data[3]).toBeCloseTo(1e-5);
    expect(hm.bestBin[0]).toBe(-1);
    expect(hm.bestVal[0]).toBe(0);

    // Display should still show data after smoothing
    smoothHeatmapDisplay(hm);
    expect(Math.max(...hm.display)).toBeGreaterThan(0);
  });

  it('hasData passes with realistic weak signal levels', () => {
    const hm = createHeatmap([0], 240);
    const profile = new Float32Array(240);

    // Simulate typical weak signal: most bins ~1e-6, peak ~2e-4
    for (let i = 0; i < 240; i++) profile[i] = 1e-6;
    profile[120] = 2e-4;

    updateHeatmapRow(hm, 0, profile, 120, 2e-4);
    smoothHeatmapDisplay(hm);

    let displayMax = 0;
    for (let i = 0; i < hm.display.length; i++) {
      if (hm.display[i] > displayMax) displayMax = hm.display[i];
    }

    // This is the exact check used in drawHeatmap
    const hasData = displayMax > 1e-12;
    expect(hasData).toBe(true);
  });
});
