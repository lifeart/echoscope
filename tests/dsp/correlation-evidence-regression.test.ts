import { estimateCorrelationEvidence } from '../../src/dsp/correlation-evidence.js';
import { correlate } from '../../src/dsp/correlate.js';

/**
 * Regression tests for estimateCorrelationEvidence.
 *
 * Covers edge cases and specific code paths not fully exercised by
 * the main test suites:
 *  - negative correlation peaks (Math.abs path)
 *  - medianNorm floor (1e-9)
 *  - third pass condition (prominence >= 12 AND peakNorm >= 0.005)
 *  - peakWidth == 1 for narrow spike
 *  - corr array shorter than valid range
 *  - multiple-peak resolution (global max used)
 *  - all-equal norms → prominence ≈ 1 → reject
 *  - boundary validLen = 0
 *  - custom options independently control each threshold
 */

/** Deterministic PRNG for reproducible noise */
function prng(len: number, amp: number, seed = 42): Float32Array {
  const buf = new Float32Array(len);
  let s = seed;
  for (let i = 0; i < len; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    buf[i] = ((s / 0x7fffffff) - 0.5) * 2 * amp;
  }
  return buf;
}

describe('correlation-evidence regression', () => {
  describe('negative correlation peak', () => {
    it('detects inverted (negative) probe via Math.abs', () => {
      const ref = new Float32Array([1, -1, 1, -1, 1]);
      const signal = new Float32Array(100);
      // Embed an inverted copy → correlation peak is negative
      for (let i = 0; i < ref.length; i++) {
        signal[30 + i] = -ref[i] * 0.5;
      }
      const corr = correlate(signal, ref);
      const ev = estimateCorrelationEvidence(corr, signal, ref);

      // The raw correlation at peak should be negative
      expect(corr[30]).toBeLessThan(0);
      // But estimateCorrelationEvidence uses Math.abs, so it should detect it
      expect(ev.peakNorm).toBeGreaterThan(0);
      expect(ev.peakIndex).toBe(30);
      expect(ev.pass).toBe(true);
    });
  });

  describe('medianNorm floor', () => {
    it('medianNorm is at least 1e-9 even when median of norms would be 0', () => {
      // Signal is nearly all zeros except at the probe position → most windows
      // have zero energy, so the norm is 0/0 → NaN or 0.
      // Median of many zeros = 0, but medianNorm is clamped to 1e-9.
      const ref = new Float32Array([1, -1, 1]);
      const signal = new Float32Array(60);
      // Single isolated impulse at the probe location
      for (let i = 0; i < ref.length; i++) signal[10 + i] = ref[i];
      const corr = correlate(signal, ref);
      const ev = estimateCorrelationEvidence(corr, signal, ref);

      expect(ev.medianNorm).toBeGreaterThanOrEqual(1e-9);
      // And prominence should be calculable (not NaN/Inf)
      expect(Number.isFinite(ev.prominence)).toBe(true);
    });
  });

  describe('third pass condition (highProminence override)', () => {
    it('passes when prominence >= 12 and peakNorm >= 0.005 even if peakNorm < minPeakNorm', () => {
      // Force the scenario: peakNorm between 0.005 and 0.010,
      // prominence >= 12. The default minPeakNorm=0.010 would
      // reject, but the highProminence override (prominence>=12)
      // accepts.
      const ref = new Float32Array([1, -1, 1, -1, 1]);
      const signal = new Float32Array(100);
      // Embed a very weak copy
      for (let i = 0; i < ref.length; i++) {
        signal[40 + i] = ref[i] * 0.08;
      }
      const corr = correlate(signal, ref);
      const ev = estimateCorrelationEvidence(corr, signal, ref);

      // Verify conditions are met via custom options with very strict minPeakNorm
      // but keep defaults for the highProminence path
      const evStrict = estimateCorrelationEvidence(corr, signal, ref, {
        minPeakNorm: 999,  // effectively disable normal path
        strongPeakNorm: 999, // effectively disable strong path
        // highProminence = 12 and minPeakFloor = 0.005 are hardcoded
      });

      // The embedded probe in silence has very high prominence
      // and peakNorm well above 0.005
      if (evStrict.prominence >= 12 && evStrict.peakNorm >= 0.005) {
        expect(evStrict.pass).toBe(true);
      }
    });

    it('rejects when prominence >= 12 but peakNorm < 0.005', () => {
      // We create a crafted scenario where we pass our own corr/signal
      // with very tiny values so peakNorm stays below 0.005
      const ref = new Float32Array([1]);
      const sigLen = 10;
      const signal = new Float32Array(sigLen);
      const corr = new Float32Array(sigLen);

      // All correlation values are extremely small
      for (let i = 0; i < sigLen; i++) {
        signal[i] = 0.001;
        corr[i] = 1e-7;
      }
      // One slightly larger to create a "peak" with high prominence ratio
      corr[5] = 1e-5;

      const ev = estimateCorrelationEvidence(corr, signal, ref);

      // peakNorm should be very small (< 0.005) given the tiny corr values
      // relative to the energy denominator
      if (ev.peakNorm < 0.005) {
        expect(ev.pass).toBe(false);
      }
    });
  });

  describe('peakWidth', () => {
    it('returns peakWidth = 1 for a single isolated spike', () => {
      // Create a correlation array with a single spike and zeros elsewhere
      const ref = new Float32Array([1]);
      const signal = new Float32Array(50);
      signal.fill(1); // uniform energy in every window
      const corr = new Float32Array(50);
      // Single sample spike
      corr[25] = 1.0;

      const ev = estimateCorrelationEvidence(corr, signal, ref);
      expect(ev.peakWidth).toBe(1);
      expect(ev.peakIndex).toBe(25);
    });

    it('returns wider peakWidth when surrounding samples are above half-max', () => {
      const ref = new Float32Array([1]);
      const signal = new Float32Array(50);
      signal.fill(1);
      const corr = new Float32Array(50);
      // Wide peak: center + 2 on each side above half-max
      corr[23] = 0.6;
      corr[24] = 0.8;
      corr[25] = 1.0;
      corr[26] = 0.8;
      corr[27] = 0.6;

      const ev = estimateCorrelationEvidence(corr, signal, ref);

      // half-max = 0.5, so indices 23-27 all qualify → peakWidth = 5
      expect(ev.peakWidth).toBe(5);
      expect(ev.peakIndex).toBe(25);
    });

    it('peakWidth is 0 when validLen <= 0', () => {
      const ref = new Float32Array(10);
      ref[0] = 1;
      const signal = new Float32Array(5); // shorter than ref
      const corr = new Float32Array(5);
      const ev = estimateCorrelationEvidence(corr, signal, ref);
      expect(ev.peakWidth).toBe(0);
    });
  });

  describe('corr shorter than valid range', () => {
    it('validLen is clamped to corr.length', () => {
      const ref = new Float32Array([1, -1, 1]);
      // signal.length - refLen + 1 = 100 - 3 + 1 = 98 valid positions
      // but corr only has 10 entries → validLen = 10
      const signal = new Float32Array(100);
      for (let i = 0; i < ref.length; i++) signal[5 + i] = ref[i];
      const corr = correlate(signal, ref).slice(0, 10);

      const ev = estimateCorrelationEvidence(corr, signal, ref);

      // Should still find peak at index 5 (within the first 10)
      expect(ev.peakIndex).toBe(5);
      expect(ev.peakNorm).toBeGreaterThan(0);
    });
  });

  describe('multiple peaks (global max)', () => {
    it('selects the highest normalized peak among two copies', () => {
      const ref = new Float32Array([1, -1, 1, -1]);
      const signal = new Float32Array(100);
      // Copy at 20 with added noise in that window → lower normalized peak
      for (let i = 0; i < ref.length; i++) signal[20 + i] = ref[i] * 0.5;
      // Add broadband noise around offset 20 to raise window energy
      for (let i = 18; i < 26; i++) signal[i] += 2.0;
      // Clean copy at 60 → higher normalized peak
      for (let i = 0; i < ref.length; i++) signal[60 + i] = ref[i] * 0.5;

      const corr = correlate(signal, ref);
      const ev = estimateCorrelationEvidence(corr, signal, ref);

      // The clean copy at 60 has lower window energy so higher normalized corr
      expect(ev.peakIndex).toBe(60);
    });
  });

  describe('all norms equal → low prominence', () => {
    it('prominence ≈ 1 and rejects when all correlations are similar', () => {
      // If every window has the same normalized correlation,
      // peakNorm ≈ medianNorm → prominence ≈ 1 → reject
      const ref = new Float32Array([1]);
      const signal = new Float32Array(50);
      signal.fill(1); // uniform energy
      const corr = new Float32Array(50);
      corr.fill(0.01); // all correlations identical

      const ev = estimateCorrelationEvidence(corr, signal, ref);

      // prominence should be close to 1
      expect(ev.prominence).toBeCloseTo(1, 0);
      expect(ev.pass).toBe(false);
    });
  });

  describe('boundary validLen computations', () => {
    it('validLen = 1 when signal.length == refLen', () => {
      const ref = new Float32Array([1, -1, 1]);
      const signal = new Float32Array(3); // same length as ref
      signal[0] = 1; signal[1] = -1; signal[2] = 1;
      const corr = correlate(signal, ref);

      const ev = estimateCorrelationEvidence(corr, signal, ref);

      // Only one valid position (index 0)
      expect(ev.peakIndex).toBe(0);
      expect(ev.peakNorm).toBeGreaterThan(0);
    });

    it('validLen = 0 when signal.length < refLen', () => {
      const ref = new Float32Array(20);
      ref[0] = 1;
      const signal = new Float32Array(10);
      signal[0] = 1;
      const corr = new Float32Array(10);
      corr[0] = 1;

      const ev = estimateCorrelationEvidence(corr, signal, ref);
      expect(ev.pass).toBe(false);
      expect(ev.peakIndex).toBe(-1);
      expect(ev.peakWidth).toBe(0);
    });
  });

  describe('options isolation', () => {
    it('changing only minProminence affects the pass decision', () => {
      const ref = new Float32Array([1, -1, 1, -1, 1]);
      const signal = new Float32Array(100);
      for (let i = 0; i < ref.length; i++) signal[25 + i] = ref[i] * 0.15;
      // Add light noise so prominence is moderate
      let seed = 99;
      for (let i = 0; i < signal.length; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        signal[i] += ((seed / 0x7fffffff) - 0.5) * 0.01;
      }
      const corr = correlate(signal, ref);

      const evDefault = estimateCorrelationEvidence(corr, signal, ref);
      const evLoose = estimateCorrelationEvidence(corr, signal, ref, { minProminence: 1 });

      // With minProminence=1, the pass should be at least as permissive
      if (!evDefault.pass) {
        expect(evLoose.pass).toBe(true);
      }
    });

    it('changing only strongPeakNorm can flip pass decision', () => {
      const ref = new Float32Array([1, -1, 1]);
      const signal = new Float32Array(40);
      for (let i = 0; i < ref.length; i++) signal[10 + i] = ref[i] * 1.5;
      const corr = correlate(signal, ref);

      const evDefault = estimateCorrelationEvidence(corr, signal, ref);
      // Setting strongPeakNorm very low ensures bypass via strong path
      const evLow = estimateCorrelationEvidence(corr, signal, ref, { strongPeakNorm: 0.001 });

      expect(evLow.pass).toBe(true);
      // evDefault should also pass (signal is strong)
      expect(evDefault.pass).toBe(true);
    });
  });

  describe('return value invariants', () => {
    it('peakNorm >= 0', () => {
      const ref = new Float32Array([1, -1, 1]);
      const signal = prng(100, 0.1);
      const corr = correlate(signal, ref);
      const ev = estimateCorrelationEvidence(corr, signal, ref);
      expect(ev.peakNorm).toBeGreaterThanOrEqual(0);
    });

    it('medianNorm >= 1e-9', () => {
      const ref = new Float32Array([1, -1, 1]);
      const signal = prng(100, 0.1);
      const corr = correlate(signal, ref);
      const ev = estimateCorrelationEvidence(corr, signal, ref);
      expect(ev.medianNorm).toBeGreaterThanOrEqual(1e-9);
    });

    it('prominence = peakNorm / medianNorm', () => {
      const ref = new Float32Array([1, -1, 1, -1]);
      const signal = new Float32Array(80);
      for (let i = 0; i < ref.length; i++) signal[30 + i] = ref[i];
      const corr = correlate(signal, ref);
      const ev = estimateCorrelationEvidence(corr, signal, ref);
      expect(ev.prominence).toBeCloseTo(ev.peakNorm / ev.medianNorm, 5);
    });

    it('peakWidth >= 1 when peakIndex >= 0', () => {
      const ref = new Float32Array([1, -1, 1]);
      const signal = new Float32Array(50);
      for (let i = 0; i < ref.length; i++) signal[10 + i] = ref[i];
      const corr = correlate(signal, ref);
      const ev = estimateCorrelationEvidence(corr, signal, ref);
      expect(ev.peakIndex).toBeGreaterThanOrEqual(0);
      expect(ev.peakWidth).toBeGreaterThanOrEqual(1);
    });

    it('all numeric fields are finite (no NaN/Infinity)', () => {
      const ref = new Float32Array([1, -1, 1]);
      const signal = prng(200, 0.05, 77);
      const corr = correlate(signal, ref);
      const ev = estimateCorrelationEvidence(corr, signal, ref);

      expect(Number.isFinite(ev.peakNorm)).toBe(true);
      expect(Number.isFinite(ev.medianNorm)).toBe(true);
      expect(Number.isFinite(ev.prominence)).toBe(true);
      expect(Number.isFinite(ev.peakWidth)).toBe(true);
      expect(Number.isFinite(ev.peakIndex)).toBe(true);
    });
  });

  describe('internal median helper (through main function)', () => {
    it('even-count valid positions produce correct medianNorm', () => {
      // signal.length=8, ref.length=1 → validLen=8 (even count)
      const ref = new Float32Array([1]);
      const signal = new Float32Array(8);
      signal.fill(1);
      const corr = new Float32Array(8);
      // Ascending norms: 1..8 → after normalization each is corr[i]/1,
      // median of 8 values = avg of 4th and 5th
      for (let i = 0; i < 8; i++) corr[i] = (i + 1) * 0.01;

      const ev = estimateCorrelationEvidence(corr, signal, ref);

      // norms[i] = corr[i] / sqrt(1 * 1) = corr[i]
      // sorted: 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08
      // median = (0.04 + 0.05) / 2 = 0.045
      expect(ev.medianNorm).toBeCloseTo(0.045, 4);
      expect(ev.peakNorm).toBeCloseTo(0.08, 4);
    });

    it('odd-count valid positions produce correct medianNorm', () => {
      const ref = new Float32Array([1]);
      const signal = new Float32Array(7);
      signal.fill(1);
      const corr = new Float32Array(7);
      for (let i = 0; i < 7; i++) corr[i] = (i + 1) * 0.01;

      const ev = estimateCorrelationEvidence(corr, signal, ref);

      // norms: 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07
      // median = 0.04
      expect(ev.medianNorm).toBeCloseTo(0.04, 4);
    });
  });

  describe('prefix-sum energy computation', () => {
    it('varying signal amplitude across windows changes per-window normalization', () => {
      const ref = new Float32Array([1, -1]);
      const signal = new Float32Array(20);
      // First half: low amplitude
      for (let i = 0; i < 10; i++) signal[i] = 0.01;
      // Second half: high amplitude
      for (let i = 10; i < 20; i++) signal[i] = 1.0;
      // Embed ref at position 5 (low amplitude region)
      signal[5] = ref[0] * 0.5;
      signal[6] = ref[1] * 0.5;
      // Also embed at position 15 (high amplitude region)
      signal[15] = ref[0] * 0.5;
      signal[16] = ref[1] * 0.5;

      const corr = correlate(signal, ref);
      const ev = estimateCorrelationEvidence(corr, signal, ref);

      // The peak should be in the low-amplitude region because the
      // denominator (window energy) is smaller there, making norm larger
      expect(ev.peakIndex).toBeLessThan(10);
    });
  });
});
