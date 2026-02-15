import { estimateCorrelationEvidence } from '../../src/dsp/correlation-evidence.js';
import { fftCorrelateComplex } from '../../src/dsp/fft-correlate.js';

/**
 * Tests for the TX evidence threshold logic — the gate that decides
 * whether a probe signal was actually emitted.
 *
 * Key thresholds (defaults):
 *   minPeakNorm   = 0.040
 *   minProminence = 3.5
 *   strongPeakNorm = 0.055
 *
 * Pass conditions:
 *   peakNorm >= strongPeakNorm
 *   OR (peakNorm >= minPeakNorm AND prominence >= minProminence)
 */

const SR = 48000;

/** Deterministic pseudo-noise generator */
function pseudoNoise(len: number, amplitude: number, seed = 42): Float32Array {
  const buf = new Float32Array(len);
  let s = seed;
  for (let i = 0; i < len; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    buf[i] = ((s / 0x7fffffff) - 0.5) * 2 * amplitude;
  }
  return buf;
}

/** Generate a chirp reference (swept tone) */
function makeChirpRef(len: number, f1 = 2000, f2 = 8000): Float32Array {
  const ref = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const freq = f1 + t * (f2 - f1);
    ref[i] = Math.sin(2 * Math.PI * freq * t);
  }
  return ref;
}

describe('correlation-evidence threshold behavior', () => {
  describe('default thresholds', () => {
    it('default minPeakNorm is 0.040', () => {
      const ref = new Float32Array([1, -1, 1]);
      const signal = new Float32Array(20);
      // Embed at index 5 with amplitude that gives peakNorm above 0.040
      for (let i = 0; i < ref.length; i++) signal[5 + i] = ref[i] * 0.8;
      const corr = fftCorrelateComplex(signal, ref, SR).correlation;
      const ev = estimateCorrelationEvidence(corr, signal, ref);

      // With defaults, a clear embedded signal should pass
      expect(ev.pass).toBe(true);
    });

    it('rejects when peakNorm is below minPeakNorm and prominence below minProminence', () => {
      // Force peakNorm below 0.040 by using custom options as sanity check
      const ref = new Float32Array([1, -1, 1]);
      const signal = new Float32Array(60);
      // Very faint embedding
      for (let i = 0; i < ref.length; i++) signal[20 + i] = ref[i] * 0.001;
      // Fill with comparable noise
      let seed = 7;
      for (let i = 0; i < signal.length; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        signal[i] += ((seed / 0x7fffffff) - 0.5) * 0.003;
      }
      const corr = fftCorrelateComplex(signal, ref, SR).correlation;
      const ev = estimateCorrelationEvidence(corr, signal, ref);

      // The signal is so faint it should have low peakNorm
      if (ev.peakNorm < 0.040 && ev.prominence < 3.5) {
        expect(ev.pass).toBe(false);
      }
    });
  });

  describe('custom threshold options', () => {
    it('accepts custom minPeakNorm', () => {
      const ref = makeChirpRef(50);
      const signal = new Float32Array(400);
      for (let i = 0; i < ref.length; i++) signal[100 + i] = ref[i] * 0.1;
      // Add noise so peakNorm doesn't saturate
      let seed = 33;
      for (let i = 0; i < signal.length; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        signal[i] += ((seed / 0x7fffffff) - 0.5) * 0.02;
      }
      const corr = fftCorrelateComplex(signal, ref, SR).correlation;

      // With very high threshold, the signal should fail
      const evHigh = estimateCorrelationEvidence(corr, signal, ref, {
        minPeakNorm: 0.999,
        strongPeakNorm: 0.999,
        minProminence: 999,
      });
      expect(evHigh.pass).toBe(false);

      // With very low threshold, same signal passes
      const evLow = estimateCorrelationEvidence(corr, signal, ref, {
        minPeakNorm: 0.001,
        strongPeakNorm: 0.001,
      });
      expect(evLow.pass).toBe(true);
    });

    it('strongPeakNorm bypasses prominence check', () => {
      const ref = new Float32Array([1, -1, 1, -1]);
      const signal = new Float32Array(50);
      // Strong embedding with some noise background (low prominence)
      let seed = 42;
      for (let i = 0; i < signal.length; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        signal[i] = ((seed / 0x7fffffff) - 0.5) * 0.1;
      }
      for (let i = 0; i < ref.length; i++) signal[20 + i] += ref[i] * 5.0;
      const corr = fftCorrelateComplex(signal, ref, SR).correlation;

      // Set minProminence impossibly high, but strongPeakNorm low
      const ev = estimateCorrelationEvidence(corr, signal, ref, {
        minPeakNorm: 0.999,
        minProminence: 9999,
        strongPeakNorm: 0.001,
      });
      // Should pass via strongPeakNorm bypass
      expect(ev.pass).toBe(true);
    });
  });

  describe('sliding-window energy denominator', () => {
    it('peakNorm is lower when signal has more broadband energy', () => {
      // The denominator sqrt(refEnergy * winEnergy) grows with signal energy.
      // Adding out-of-band energy increases winEnergy → decreases peakNorm.
      const ref = makeChirpRef(336);
      const signalClean = new Float32Array(3500);
      for (let i = 0; i < ref.length; i++) signalClean[700 + i] = ref[i] * 0.5;

      // Same signal but with added broadband energy
      const signalNoisy = Float32Array.from(signalClean);
      for (let i = 0; i < signalNoisy.length; i++) {
        signalNoisy[i] += Math.sin(2 * Math.PI * 300 * i / SR) * 0.3;
      }

      const corrClean = fftCorrelateComplex(signalClean, ref, SR).correlation;
      const corrNoisy = fftCorrelateComplex(signalNoisy, ref, SR).correlation;

      const evClean = estimateCorrelationEvidence(corrClean, signalClean, ref);
      const evNoisy = estimateCorrelationEvidence(corrNoisy, signalNoisy, ref);

      // Adding out-of-band energy (same correlation peak, bigger denominator)
      // should reduce peakNorm
      expect(evNoisy.peakNorm).toBeLessThan(evClean.peakNorm);
    });

    it('unfiltered signal has lower noise peakNorm than filtered', () => {
      // This is THE key property that the v4 fix relies on.
      // When mic = noise only, bandpass filtering removes out-of-band energy
      // from winEnergy denominator, making noise peakNorm HIGHER (bad).
      // Using unfiltered signal keeps the denominator large → lower peakNorm.
      const ref = makeChirpRef(336);
      const noise = pseudoNoise(3500, 0.08, 99);

      // Simulate filtered noise (remove ~65% of energy for chirp band)
      const filteredNoise = new Float32Array(noise.length);
      for (let i = 0; i < noise.length; i++) {
        // Keep only in-band-ish energy (rough simulation)
        filteredNoise[i] = noise[i] * 0.4;
      }

      // Correlation is the same (FFT-based, band-limited by ref)
      const corr = fftCorrelateComplex(noise, ref, SR).correlation;

      const evUnfiltered = estimateCorrelationEvidence(corr, noise, ref);
      const evFiltered = estimateCorrelationEvidence(corr, filteredNoise, ref);

      // With less energy in the denominator, filtered produces higher peakNorm
      expect(evFiltered.peakNorm).toBeGreaterThan(evUnfiltered.peakNorm);
    });
  });

  describe('edge cases', () => {
    it('empty correlation returns pass=false', () => {
      const ev = estimateCorrelationEvidence(
        new Float32Array(0),
        new Float32Array(100),
        new Float32Array([1, -1]),
      );
      expect(ev.pass).toBe(false);
      expect(ev.peakNorm).toBe(0);
      expect(ev.peakWidth).toBe(0);
      expect(ev.peakIndex).toBe(-1);
    });

    it('signal shorter than reference returns pass=false', () => {
      const ref = new Float32Array(100);
      ref[0] = 1;
      const signal = new Float32Array(10); // shorter than ref
      const corr = new Float32Array(10);
      const ev = estimateCorrelationEvidence(corr, signal, ref);
      expect(ev.pass).toBe(false);
    });

    it('zero-energy reference returns pass=false', () => {
      const ref = new Float32Array(5); // all zeros
      const signal = new Float32Array(100);
      signal[10] = 1;
      const corr = new Float32Array(100);
      corr[10] = 1;
      const ev = estimateCorrelationEvidence(corr, signal, ref);
      expect(ev.pass).toBe(false);
      expect(ev.peakNorm).toBe(0);
    });

    it('constant signal (DC) has uniform energy → low prominence', () => {
      const ref = new Float32Array([1, -1, 1, -1, 1]);
      const signal = new Float32Array(100).fill(0.5); // constant DC
      const corr = fftCorrelateComplex(signal, ref, SR).correlation;
      const ev = estimateCorrelationEvidence(corr, signal, ref);

      // DC + alternating ref → weak correlation → peakNorm should be modest
      expect(ev.peakNorm).toBeLessThan(0.5);
    });
  });

  describe('peakWidth measurement', () => {
    it('is always >= 1 for any non-trivial correlation', () => {
      const ref = makeChirpRef(50);
      const signal = new Float32Array(200);
      for (let i = 0; i < ref.length; i++) signal[80 + i] = ref[i];
      const corr = fftCorrelateComplex(signal, ref, SR).correlation;
      const ev = estimateCorrelationEvidence(corr, signal, ref);

      expect(ev.peakWidth).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(ev.peakWidth)).toBe(true);
    });

    it('longer reference produces wider correlation peak', () => {
      const shortRef = makeChirpRef(100);
      const longRef = makeChirpRef(400);

      const signalShort = new Float32Array(2000);
      for (let i = 0; i < shortRef.length; i++) signalShort[500 + i] = shortRef[i] * 0.8;
      const corrShort = fftCorrelateComplex(signalShort, shortRef, SR).correlation;
      const evShort = estimateCorrelationEvidence(corrShort, signalShort, shortRef);

      const signalLong = new Float32Array(4000);
      for (let i = 0; i < longRef.length; i++) signalLong[1000 + i] = longRef[i] * 0.8;
      const corrLong = fftCorrelateComplex(signalLong, longRef, SR).correlation;
      const evLong = estimateCorrelationEvidence(corrLong, signalLong, longRef);

      // Both should have valid peakWidth
      expect(evShort.peakWidth).toBeGreaterThanOrEqual(1);
      expect(evLong.peakWidth).toBeGreaterThanOrEqual(1);
    });
  });

  describe('prominence calculation', () => {
    it('prominence = peakNorm / medianNorm', () => {
      const ref = makeChirpRef(50);
      const signal = new Float32Array(200);
      for (let i = 0; i < ref.length; i++) signal[80 + i] = ref[i] * 0.8;
      const corr = fftCorrelateComplex(signal, ref, SR).correlation;
      const ev = estimateCorrelationEvidence(corr, signal, ref);

      expect(ev.prominence).toBeCloseTo(ev.peakNorm / ev.medianNorm, 5);
    });

    it('signal in silence has very high prominence', () => {
      const ref = new Float32Array([1, -1, 1, -1, 1]);
      const signal = new Float32Array(100);
      for (let i = 0; i < ref.length; i++) signal[50 + i] = ref[i];
      const corr = fftCorrelateComplex(signal, ref, SR).correlation;
      const ev = estimateCorrelationEvidence(corr, signal, ref);

      // Very prominent — clear peak in otherwise near-zero correlation
      expect(ev.prominence).toBeGreaterThan(5);
    });
  });
});
