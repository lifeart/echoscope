import { gccPhat } from '../../src/dsp/gcc-phat.js';

/**
 * Regression test: GCC-PHAT must report a POSITIVE peakDelay when sig2
 * is a delayed copy of sig1 (sig2 lags sig1).
 *
 * The cross-spectrum convention should be conj(X1)·X2 so that the IFFT
 * peak appears at +delay when sig2 is delayed.  A sign error in the
 * imaginary part of the cross-spectrum (computing X1·conj(X2) instead)
 * produces peakDelay = −delay, which mirrors DOA angles downstream.
 */
describe('gccPhat sign correctness', () => {
  it('reports positive delay when sig2 is delayed relative to sig1', () => {
    const sr = 48000;
    const N = 2048;
    const delaySamples = 20;

    // Use a longer broadband burst so the GCC peak is unambiguous
    const sig1 = new Float32Array(N);
    const sig2 = new Float32Array(N);
    for (let i = 200; i < 400; i++) {
      sig1[i] = Math.sin(2 * Math.PI * 3000 * i / sr)
              + 0.5 * Math.sin(2 * Math.PI * 5000 * i / sr);
      if (i + delaySamples < N) {
        sig2[i + delaySamples] = sig1[i];
      }
    }

    const result = gccPhat(sig1, sig2, sr);
    const expectedDelay = delaySamples / sr;

    // The delay MUST be positive (sig2 is late) and close to expectedDelay.
    // With the sign bug, peakDelay ≈ −expectedDelay.
    expect(result.peakDelay).toBeGreaterThan(0);
    expect(Math.abs(result.peakDelay - expectedDelay)).toBeLessThan(3 / sr);
  });

  it('reports negative delay when sig1 is delayed relative to sig2', () => {
    const sr = 48000;
    const N = 2048;
    const delaySamples = 15;

    const sig1 = new Float32Array(N);
    const sig2 = new Float32Array(N);
    for (let i = 200; i < 400; i++) {
      sig2[i] = Math.sin(2 * Math.PI * 3000 * i / sr)
              + 0.5 * Math.sin(2 * Math.PI * 5000 * i / sr);
      if (i + delaySamples < N) {
        sig1[i + delaySamples] = sig2[i];
      }
    }

    const result = gccPhat(sig1, sig2, sr);
    const expectedDelay = -delaySamples / sr;

    // The delay MUST be negative (sig1 is late ⇒ sig2 leads).
    expect(result.peakDelay).toBeLessThan(0);
    expect(Math.abs(result.peakDelay - expectedDelay)).toBeLessThan(3 / sr);
  });
});
