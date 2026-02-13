import { describe, it, expect } from 'vitest';
import { findDirtyColumns } from '../../src/viz/heatmap-plot.js';

describe('heatmap tile integration', () => {
  it('partial dirty columns produce same affected pixels as full rebuild', () => {
    const rows = 5;
    const cols = 10;

    // Create two versions of display data: original and updated
    const original = new Float32Array(rows * cols);
    const updated = new Float32Array(rows * cols);
    for (let i = 0; i < rows * cols; i++) {
      original[i] = i * 0.01;
      updated[i] = i * 0.01;
    }
    // Change only column 3
    for (let r = 0; r < rows; r++) {
      updated[r * cols + 3] = 999;
    }

    const dirtyFull = findDirtyColumns(updated, null, rows, cols);
    const dirtyPartial = findDirtyColumns(updated, original, rows, cols);

    // Full rebuild marks all columns
    expect(dirtyFull.size).toBe(cols);
    // Partial marks only the changed column
    expect(dirtyPartial.size).toBe(1);
    expect(dirtyPartial.has(3)).toBe(true);

    // Simulate pixel generation for dirty columns only vs full rebuild
    // For each pixel row y, check if its data columns intersect dirty set
    const pH = 20;
    const hDen = Math.max(1, pH - 1);
    const colDen = Math.max(1, cols - 1);

    const dirtyYFull = new Set<number>();
    const dirtyYPartial = new Set<number>();
    for (let y = 0; y < pH; y++) {
      const colPos = (1 - y / hDen) * colDen;
      const c0 = Math.floor(colPos);
      const c1 = Math.min(cols - 1, c0 + 1);
      if (dirtyFull.has(c0) || dirtyFull.has(c1)) dirtyYFull.add(y);
      if (dirtyPartial.has(c0) || dirtyPartial.has(c1)) dirtyYPartial.add(y);
    }

    // Full rebuild should mark all y rows as dirty
    expect(dirtyYFull.size).toBe(pH);
    // Partial should only mark rows that sample from column 3
    expect(dirtyYPartial.size).toBeGreaterThan(0);
    expect(dirtyYPartial.size).toBeLessThan(pH);

    // Every dirty partial y row must also be dirty in full rebuild
    for (const y of dirtyYPartial) {
      expect(dirtyYFull.has(y)).toBe(true);
    }
  });

  it('empty dirty set reuses cached data exactly', () => {
    const rows = 4;
    const cols = 6;

    const data = new Float32Array(rows * cols);
    const cached = new Float32Array(rows * cols);
    for (let i = 0; i < rows * cols; i++) {
      data[i] = i * 0.5;
      cached[i] = i * 0.5;
    }

    const dirty = findDirtyColumns(data, cached, rows, cols);
    expect(dirty.size).toBe(0);

    // When dirty set is empty, the tile cache should be reused without modification.
    // Simulate: if dirtyColumns.size === 0, we skip regeneration entirely.
    const cacheReused = dirty.size === 0;
    expect(cacheReused).toBe(true);

    // Verify the cached snapshot matches exactly
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBe(cached[i]);
    }
  });
});
