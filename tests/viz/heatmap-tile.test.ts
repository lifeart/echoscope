import { describe, it, expect } from 'vitest';
import { findDirtyColumns } from '../../src/viz/heatmap-plot.js';

describe('findDirtyColumns', () => {
  it('returns all columns on null cache', () => {
    const rows = 4;
    const cols = 5;
    const data = new Float32Array(rows * cols);
    for (let i = 0; i < data.length; i++) data[i] = i;

    const dirty = findDirtyColumns(data, null, rows, cols);

    expect(dirty.size).toBe(cols);
    for (let c = 0; c < cols; c++) {
      expect(dirty.has(c)).toBe(true);
    }
  });

  it('returns all columns when cache has different length', () => {
    const rows = 4;
    const cols = 5;
    const data = new Float32Array(rows * cols);
    const cached = new Float32Array(rows * cols + 1); // different length

    const dirty = findDirtyColumns(data, cached, rows, cols);
    expect(dirty.size).toBe(cols);
  });

  it('detects single changed column', () => {
    const rows = 3;
    const cols = 4;
    const data = new Float32Array(rows * cols);
    const cached = new Float32Array(rows * cols);
    // Fill both identically
    for (let i = 0; i < data.length; i++) {
      data[i] = i * 0.1;
      cached[i] = i * 0.1;
    }
    // Change column 2, row 1
    data[1 * cols + 2] = 999;

    const dirty = findDirtyColumns(data, cached, rows, cols);
    expect(dirty.size).toBe(1);
    expect(dirty.has(2)).toBe(true);
  });

  it('detects multiple changed columns', () => {
    const rows = 5;
    const cols = 8;
    const data = new Float32Array(rows * cols);
    const cached = new Float32Array(rows * cols);
    for (let i = 0; i < data.length; i++) {
      data[i] = 1.0;
      cached[i] = 1.0;
    }
    // Change columns 1, 3, and 7
    data[0 * cols + 1] = 2.0;
    data[2 * cols + 3] = 3.0;
    data[4 * cols + 7] = 4.0;

    const dirty = findDirtyColumns(data, cached, rows, cols);
    expect(dirty.size).toBe(3);
    expect(dirty.has(1)).toBe(true);
    expect(dirty.has(3)).toBe(true);
    expect(dirty.has(7)).toBe(true);
  });

  it('returns empty set when data is unchanged', () => {
    const rows = 4;
    const cols = 6;
    const data = new Float32Array(rows * cols);
    const cached = new Float32Array(rows * cols);
    for (let i = 0; i < data.length; i++) {
      data[i] = i * 0.5;
      cached[i] = i * 0.5;
    }

    const dirty = findDirtyColumns(data, cached, rows, cols);
    expect(dirty.size).toBe(0);
  });

  it('handles single-column data', () => {
    const rows = 3;
    const cols = 1;
    const data = new Float32Array([1, 2, 3]);
    const cached = new Float32Array([1, 2, 4]);

    const dirty = findDirtyColumns(data, cached, rows, cols);
    expect(dirty.size).toBe(1);
    expect(dirty.has(0)).toBe(true);
  });

  it('handles single-row data', () => {
    const rows = 1;
    const cols = 5;
    const data = new Float32Array([1, 2, 3, 4, 5]);
    const cached = new Float32Array([1, 2, 3, 4, 5]);

    const dirty = findDirtyColumns(data, cached, rows, cols);
    expect(dirty.size).toBe(0);
  });
});
