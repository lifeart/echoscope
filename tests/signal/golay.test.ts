import { genGolayPair, genGolayChipped } from '../../src/signal/golay.js';
import { correlate } from '../../src/dsp/correlate.js';

describe('genGolayPair', () => {
  it('generates correct length', () => {
    const { A, B } = genGolayPair(6);
    expect(A.length).toBe(64);
    expect(B.length).toBe(64);
  });

  it('autocorrelation sum is delta-like', () => {
    const { A, B } = genGolayPair(6);
    const aF = new Float32Array(A.length);
    const bF = new Float32Array(B.length);
    for (let i = 0; i < A.length; i++) { aF[i] = A[i]; bF[i] = B[i]; }

    // Pad for full autocorrelation
    const N = A.length * 2;
    const sigA = new Float32Array(N); sigA.set(aF);
    const sigB = new Float32Array(N); sigB.set(bF);

    const corrA = correlate(sigA, aF);
    const corrB = correlate(sigB, bF);

    // Sum should have a peak at index 0 and be near-zero elsewhere
    const sum = new Float32Array(Math.min(corrA.length, corrB.length));
    for (let i = 0; i < sum.length; i++) sum[i] = corrA[i] + corrB[i];

    // Peak at 0
    let maxIdx = 0, maxVal = -Infinity;
    for (let i = 0; i < sum.length; i++) {
      if (sum[i] > maxVal) { maxVal = sum[i]; maxIdx = i; }
    }
    expect(maxIdx).toBe(0);

    // Sidelobes should be much smaller than peak
    for (let i = 1; i < sum.length; i++) {
      expect(Math.abs(sum[i]) / maxVal).toBeLessThan(0.01);
    }
  });

  it('throws for invalid order', () => {
    expect(() => genGolayPair(0)).toThrow();
    expect(() => genGolayPair(15)).toThrow();
  });
});

describe('genGolayChipped', () => {
  it('generates audio pairs', () => {
    const { a, b } = genGolayChipped({ order: 6, chipRate: 5000, gapMs: 12 }, 48000);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a.length).toBe(b.length);
  });
});
