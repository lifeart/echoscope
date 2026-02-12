import { correlate } from '../../src/dsp/correlate.js';

describe('correlate', () => {
  it('returns empty array for empty inputs', () => {
    expect(correlate(new Float32Array(0), new Float32Array(0)).length).toBe(0);
  });

  it('returns empty when signal shorter than reference', () => {
    const x = new Float32Array([1, 2]);
    const s = new Float32Array([1, 2, 3]);
    expect(correlate(x, s).length).toBe(0);
  });

  it('computes correct cross-correlation', () => {
    const x = new Float32Array([0, 0, 1, 0, 0]);
    const s = new Float32Array([1]);
    const result = correlate(x, s);
    expect(result.length).toBe(5);
    expect(result[2]).toBe(1);
  });

  it('finds delayed copy', () => {
    const s = new Float32Array([1, -1, 1]);
    const x = new Float32Array([0, 0, 0, 1, -1, 1, 0, 0]);
    const result = correlate(x, s);
    // Peak should be at index 3
    let maxIdx = 0, maxVal = -Infinity;
    for (let i = 0; i < result.length; i++) {
      if (result[i] > maxVal) { maxVal = result[i]; maxIdx = i; }
    }
    expect(maxIdx).toBe(3);
    expect(maxVal).toBe(3);
  });
});
