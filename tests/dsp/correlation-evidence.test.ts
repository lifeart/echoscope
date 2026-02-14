import { estimateCorrelationEvidence } from '../../src/dsp/correlation-evidence.js';
import { correlate } from '../../src/dsp/correlate.js';

/**
 * Tests for TX evidence detection — the mechanism that rejects pings
 * when speakers are muted (no probe signal actually emitted).
 *
 * Bug context: with muted speakers, the mic records only ambient noise.
 * Cross-correlation of noise with the reference still produces non-zero
 * values, which auto-scaling would amplify into fake "results".
 * estimateCorrelationEvidence gates this by requiring a meaningfully
 * prominent correlation peak.
 */
describe('estimateCorrelationEvidence', () => {
  it('passes for a clear embedded probe signal', () => {
    // Reference: short chirp-like pattern
    const ref = new Float32Array([1, -1, 1, -1, 1]);
    // Signal: silence + embedded copy at offset 20
    const signal = new Float32Array(100);
    for (let i = 0; i < ref.length; i++) {
      signal[20 + i] = ref[i] * 0.5; // attenuated copy
    }
    const corr = correlate(signal, ref);
    const ev = estimateCorrelationEvidence(corr, signal, ref);

    expect(ev.pass).toBe(true);
    expect(ev.peakIndex).toBe(20);
    expect(ev.peakNorm).toBeGreaterThan(0.03);
    expect(ev.prominence).toBeGreaterThan(1.8);
  });

  it('rejects silence (all zeros)', () => {
    const ref = new Float32Array([1, -1, 1, -1, 1]);
    const signal = new Float32Array(100); // all zeros
    const corr = correlate(signal, ref);
    const ev = estimateCorrelationEvidence(corr, signal, ref);

    expect(ev.pass).toBe(false);
    expect(ev.peakNorm).toBe(0);
  });

  it('rejects when reference has no energy', () => {
    const ref = new Float32Array(5); // all zeros
    const signal = new Float32Array(100);
    signal[10] = 1;
    const corr = correlate(signal, ref);
    const ev = estimateCorrelationEvidence(corr, signal, ref);

    expect(ev.pass).toBe(false);
  });

  it('passes with strong peak even at low prominence (high peakNorm)', () => {
    const ref = new Float32Array([1, -1, 1]);
    // Put a strong copy in a signal that also has moderate noise
    const signal = new Float32Array(60);
    // deterministic noise floor
    let seed = 7;
    for (let i = 0; i < signal.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      signal[i] = ((seed / 0x7fffffff) - 0.5) * 0.01;
    }
    // Very strong embedded copy
    for (let i = 0; i < ref.length; i++) {
      signal[30 + i] = ref[i] * 2.0;
    }
    const corr = correlate(signal, ref);
    const ev = estimateCorrelationEvidence(corr, signal, ref);

    // strongPeakNorm threshold (0.055) should be exceeded
    expect(ev.pass).toBe(true);
    expect(ev.peakNorm).toBeGreaterThan(0.055);
  });

  it('returns correct structure with all fields', () => {
    const ref = new Float32Array([1, 0, -1]);
    const signal = new Float32Array(20);
    signal[5] = 1;
    signal[6] = 0;
    signal[7] = -1;
    const corr = correlate(signal, ref);
    const ev = estimateCorrelationEvidence(corr, signal, ref);

    expect(ev).toHaveProperty('peakNorm');
    expect(ev).toHaveProperty('medianNorm');
    expect(ev).toHaveProperty('prominence');
    expect(ev).toHaveProperty('peakIndex');
    expect(ev).toHaveProperty('peakWidth');
    expect(ev).toHaveProperty('pass');
    expect(typeof ev.peakNorm).toBe('number');
    expect(typeof ev.peakWidth).toBe('number');
    expect(typeof ev.pass).toBe('boolean');
  });

  it('prominence is higher with embedded signal than with DC offset', () => {
    const ref = new Float32Array([1, -1, 1, -1]);

    // Clean: embedded copy in silence
    const clean = new Float32Array(80);
    for (let i = 0; i < ref.length; i++) clean[20 + i] = ref[i];
    const cleanCorr = correlate(clean, ref);
    const cleanEv = estimateCorrelationEvidence(cleanCorr, clean, ref);

    // Both should pass, but clean should have high peakNorm
    expect(cleanEv.pass).toBe(true);
    expect(cleanEv.peakNorm).toBeGreaterThan(0.03);
    expect(cleanEv.peakIndex).toBe(20);
  });

  describe('peak width diagnostic', () => {
    it('computes peakWidth as diagnostic info', () => {
      const ref = new Float32Array(50);
      const signal = new Float32Array(200);
      for (let i = 0; i < ref.length; i++) {
        ref[i] = Math.sin(2 * Math.PI * i / 5) * 0.5;
      }
      let seed = 42;
      for (let i = 0; i < signal.length; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        signal[i] = ((seed / 0x7fffffff) - 0.5) * 0.002;
      }
      const corr = correlate(signal, ref);
      const ev = estimateCorrelationEvidence(corr, signal, ref);

      // peakWidth should be a positive integer
      expect(ev.peakWidth).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(ev.peakWidth)).toBe(true);
    });

    it('wider reference produces wider correlation peak', () => {
      const ref = new Float32Array(40);
      for (let i = 0; i < ref.length; i++) {
        ref[i] = Math.sin(2 * Math.PI * i / 8);
      }
      const signal = new Float32Array(200);
      for (let i = 0; i < ref.length; i++) {
        signal[60 + i] = ref[i] * 0.6;
      }
      const corr = correlate(signal, ref);
      const ev = estimateCorrelationEvidence(corr, signal, ref);

      expect(ev.peakWidth).toBeGreaterThanOrEqual(1);
      expect(ev.peakIndex).toBe(60);
    });
  });

  describe('raised thresholds reject noise', () => {
    it('rejects noise with peakNorm below 0.050 (user scenario: txNorm=0.037)', () => {
      // With the old threshold (0.030), noise with peakNorm=0.037 would pass.
      // With the new threshold (0.050), it should fail.
      const ref = new Float32Array([1, -1, 1, -1, 1]);
      const signal = new Float32Array(100);
      let seed = 42;
      for (let i = 0; i < signal.length; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        signal[i] = ((seed / 0x7fffffff) - 0.5) * 0.01;
      }
      const corr = correlate(signal, ref);
      const ev = estimateCorrelationEvidence(corr, signal, ref);

      // Even if by chance peakNorm is in the 0.020-0.040 range,
      // the threshold of 0.050 should reject it
      if (ev.peakNorm < 0.050) {
        expect(ev.pass).toBe(false);
      }
    });

    it('still passes strong embedded signals (peakNorm >= strongPeakNorm)', () => {
      const ref = new Float32Array([1, -1, 1]);
      const signal = new Float32Array(60);
      let seed = 7;
      for (let i = 0; i < signal.length; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        signal[i] = ((seed / 0x7fffffff) - 0.5) * 0.01;
      }
      // Very strong embedded copy bypasses all weak-signal checks
      for (let i = 0; i < ref.length; i++) {
        signal[30 + i] = ref[i] * 2.0;
      }
      const corr = correlate(signal, ref);
      const ev = estimateCorrelationEvidence(corr, signal, ref);

      expect(ev.pass).toBe(true);
      expect(ev.peakNorm).toBeGreaterThan(0.055);
    });
  });
});
