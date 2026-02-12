import { genMLS, genMLSChipped } from '../../src/signal/mls.js';
import { fftCorrelate } from '../../src/dsp/fft-correlate.js';

describe('genMLS', () => {
  it('generates correct length', () => {
    const seq = genMLS(8);
    expect(seq.length).toBe((1 << 8) - 1); // 255
  });

  it('contains only +1 and -1', () => {
    const seq = genMLS(6);
    for (let i = 0; i < seq.length; i++) {
      expect(Math.abs(seq[i])).toBe(1);
    }
  });

  it('throws for invalid order', () => {
    expect(() => genMLS(1)).toThrow();
    expect(() => genMLS(17)).toThrow();
  });

  it('generates correct length for all supported orders', () => {
    for (let order = 2; order <= 16; order++) {
      const seq = genMLS(order);
      expect(seq.length).toBe((1 << order) - 1);
    }
  });

  it('has correct balance of +1 and -1', () => {
    for (const order of [2, 5, 8, 12]) {
      const seq = genMLS(order);
      const ones = Array.from(seq).filter(v => v === 1).length;
      const neg = Array.from(seq).filter(v => v === -1).length;
      // MLS: 2^(m-1) ones, 2^(m-1) - 1 negative ones
      expect(ones).toBe(1 << (order - 1));
      expect(neg).toBe((1 << (order - 1)) - 1);
    }
  });

  it('has impulse-like circular auto-correlation', () => {
    const order = 8;
    const seq = genMLS(order);
    const L = seq.length; // 255
    for (let lag = 0; lag < L; lag++) {
      let sum = 0;
      for (let i = 0; i < L; i++) {
        sum += seq[i] * seq[(i + lag) % L];
      }
      if (lag === 0) {
        expect(sum).toBe(L); // peak = L
      } else {
        expect(sum).toBe(-1); // sidelobe = -1 for all other lags
      }
    }
  });

  it('is deterministic', () => {
    const a = genMLS(10);
    const b = genMLS(10);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('does not repeat before full length', () => {
    const seq = genMLS(6);
    const L = seq.length; // 63
    // Check a few potential sub-periods
    for (const p of [1, 3, 7, 9, 21]) {
      if (p >= L) continue;
      let matches = true;
      for (let i = 0; i < L; i++) {
        if (seq[i] !== seq[i % p]) { matches = false; break; }
      }
      expect(matches).toBe(false);
    }
  });
});

describe('genMLSChipped', () => {
  it('generates audio samples with correct length', () => {
    const result = genMLSChipped({ order: 8, chipRate: 4000 }, 48000);
    const chipSamples = Math.floor(48000 / 4000);
    expect(result.length).toBe(255 * chipSamples);
  });

  it('has correct amplitude excluding fade region', () => {
    const result = genMLSChipped({ order: 6, chipRate: 4000 }, 48000);
    // Skip fade region (192 samples at each end)
    for (let i = 200; i < result.length - 200; i++) {
      expect(Math.abs(Math.abs(result[i]) - 0.6)).toBeLessThan(1e-6);
    }
  });

  it('produces correlation peak at correct delay', () => {
    const ref = genMLSChipped({ order: 6, chipRate: 8000 }, 48000);
    const delay = 100;
    const signal = new Float32Array(ref.length + delay + 500);
    for (let i = 0; i < ref.length; i++) signal[delay + i] = ref[i];

    const corr = fftCorrelate(signal, ref, 48000);
    let peakIdx = 0, peakVal = -Infinity;
    for (let i = 0; i < corr.correlation.length; i++) {
      if (corr.correlation[i] > peakVal) {
        peakVal = corr.correlation[i];
        peakIdx = i;
      }
    }
    expect(peakIdx).toBe(delay);
  });

  it('fade envelope ramps at start and end', () => {
    const result = genMLSChipped({ order: 8, chipRate: 4000 }, 48000);
    // First sample should be near zero (faded in)
    expect(Math.abs(result[0])).toBeLessThan(0.01);
    // Last sample should be near zero (faded out)
    expect(Math.abs(result[result.length - 1])).toBeLessThan(0.01);
    // Middle should be at full amplitude
    const mid = Math.floor(result.length / 2);
    expect(Math.abs(result[mid])).toBeCloseTo(0.6, 1);
  });
});
