import { genGolayPair, genGolayChipped } from '../../src/signal/golay.js';
import { correlate } from '../../src/dsp/correlate.js';
import { fftCorrelate } from '../../src/dsp/fft-correlate.js';

describe('genGolayPair', () => {
  it('generates correct length', () => {
    const { A, B } = genGolayPair(6);
    expect(A.length).toBe(64);
    expect(B.length).toBe(64);
  });

  it('generates correct length for all valid orders', () => {
    for (let order = 1; order <= 14; order++) {
      const { A, B } = genGolayPair(order);
      expect(A.length).toBe(1 << order);
      expect(B.length).toBe(1 << order);
    }
  });

  it('contains only +1 and -1', () => {
    const { A, B } = genGolayPair(6);
    for (let i = 0; i < A.length; i++) {
      expect(Math.abs(A[i])).toBe(1);
      expect(Math.abs(B[i])).toBe(1);
    }
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

    // Peak at 0 should equal 2N
    let maxIdx = 0, maxVal = -Infinity;
    for (let i = 0; i < sum.length; i++) {
      if (sum[i] > maxVal) { maxVal = sum[i]; maxIdx = i; }
    }
    expect(maxIdx).toBe(0);
    expect(maxVal).toBe(2 * A.length); // 2N for complementary pair

    // Sidelobes should be exactly zero
    for (let i = 1; i < sum.length; i++) {
      expect(Math.abs(sum[i]) / maxVal).toBeLessThan(0.01);
    }
  });

  it('autocorrelation sum is perfect for multiple orders', () => {
    for (const order of [2, 4, 6, 8]) {
      const { A, B } = genGolayPair(order);
      const L = A.length;
      const aF = new Float32Array(L);
      const bF = new Float32Array(L);
      for (let i = 0; i < L; i++) { aF[i] = A[i]; bF[i] = B[i]; }

      const N = L * 2;
      const sigA = new Float32Array(N); sigA.set(aF);
      const sigB = new Float32Array(N); sigB.set(bF);

      const corrA = correlate(sigA, aF);
      const corrB = correlate(sigB, bF);

      const sum = new Float32Array(Math.min(corrA.length, corrB.length));
      for (let i = 0; i < sum.length; i++) sum[i] = corrA[i] + corrB[i];

      expect(sum[0]).toBe(2 * L);
      for (let i = 1; i < sum.length; i++) {
        expect(sum[i]).toBe(0);
      }
    }
  });

  it('throws for invalid order', () => {
    expect(() => genGolayPair(0)).toThrow();
    expect(() => genGolayPair(15)).toThrow();
  });

  it('is deterministic', () => {
    const a = genGolayPair(8);
    const b = genGolayPair(8);
    expect(Array.from(a.A)).toEqual(Array.from(b.A));
    expect(Array.from(a.B)).toEqual(Array.from(b.B));
  });

  it('A and B are different sequences', () => {
    const { A, B } = genGolayPair(6);
    let differ = false;
    for (let i = 0; i < A.length; i++) {
      if (A[i] !== B[i]) { differ = true; break; }
    }
    expect(differ).toBe(true);
  });
});

describe('genGolayChipped', () => {
  it('generates audio pairs with correct length', () => {
    const { a, b } = genGolayChipped({ order: 6, chipRate: 5000, gapMs: 12 }, 48000);
    const chipSamples = Math.floor(48000 / 5000);
    const expectedLen = 64 * chipSamples;
    expect(a.length).toBe(expectedLen);
    expect(b.length).toBe(expectedLen);
  });

  it('a and b have same length', () => {
    const { a, b } = genGolayChipped({ order: 8, chipRate: 4000, gapMs: 12 }, 48000);
    expect(a.length).toBe(b.length);
  });

  it('has correct amplitude excluding fade region', () => {
    const { a } = genGolayChipped({ order: 6, chipRate: 4000, gapMs: 12 }, 48000);
    // Skip fade region (192 samples at each end)
    for (let i = 200; i < a.length - 200; i++) {
      expect(Math.abs(Math.abs(a[i]) - 0.55)).toBeLessThan(1e-6);
    }
  });

  it('fade envelope ramps at start and end', () => {
    const { a } = genGolayChipped({ order: 8, chipRate: 4000, gapMs: 12 }, 48000);
    // First sample should be near zero (faded in)
    expect(Math.abs(a[0])).toBeLessThan(0.01);
    // Last sample should be near zero (faded out)
    expect(Math.abs(a[a.length - 1])).toBeLessThan(0.01);
    // Middle should be at full amplitude
    const mid = Math.floor(a.length / 2);
    expect(Math.abs(a[mid])).toBeCloseTo(0.55, 1);
  });

  it('produces correlation peak at correct delay with fftCorrelate', () => {
    const { a, b } = genGolayChipped({ order: 6, chipRate: 8000, gapMs: 12 }, 48000);
    const delay = 80;
    const signal = new Float32Array(a.length + delay + 500);

    // Embed a at delay
    for (let i = 0; i < a.length; i++) signal[delay + i] = a[i];
    const corrA = fftCorrelate(signal, a, 48000).correlation;

    // Embed b at delay
    signal.fill(0);
    for (let i = 0; i < b.length; i++) signal[delay + i] = b[i];
    const corrB = fftCorrelate(signal, b, 48000).correlation;

    // Sum correlations (Golay complementary property)
    const L = Math.min(corrA.length, corrB.length);
    const sum = new Float32Array(L);
    for (let i = 0; i < L; i++) sum[i] = corrA[i] + corrB[i];

    let peakIdx = 0, peakVal = -Infinity;
    for (let i = 0; i < sum.length; i++) {
      if (sum[i] > peakVal) { peakVal = sum[i]; peakIdx = i; }
    }
    expect(peakIdx).toBe(delay);
  });

  it('chipped A+B correlation has low sidelobes', () => {
    const { a, b } = genGolayChipped({ order: 6, chipRate: 8000, gapMs: 12 }, 48000);
    const delay = 50;
    const signal = new Float32Array(a.length + delay + 300);

    for (let i = 0; i < a.length; i++) signal[delay + i] = a[i];
    const corrA = fftCorrelate(signal, a, 48000).correlation;

    signal.fill(0);
    for (let i = 0; i < b.length; i++) signal[delay + i] = b[i];
    const corrB = fftCorrelate(signal, b, 48000).correlation;

    const L = Math.min(corrA.length, corrB.length);
    const sum = new Float32Array(L);
    for (let i = 0; i < L; i++) sum[i] = corrA[i] + corrB[i];

    let peakVal = -Infinity;
    for (let i = 0; i < sum.length; i++) {
      if (sum[i] > peakVal) peakVal = sum[i];
    }

    // Sidelobes should be much smaller than peak (< 20% — fade envelope slightly degrades complementary property)
    const chipSamples = Math.floor(48000 / 8000);
    for (let i = 0; i < sum.length; i++) {
      if (Math.abs(i - delay) > chipSamples) {
        expect(Math.abs(sum[i]) / peakVal).toBeLessThan(0.2);
      }
    }
  });
});
