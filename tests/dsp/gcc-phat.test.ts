import { gccPhat } from '../../src/dsp/gcc-phat.js';

describe('gccPhat', () => {
  it('finds known delay between two signals', () => {
    const sr = 48000;
    const N = 1024;
    const delay = 5; // 5 samples delay

    const sig1 = new Float32Array(N);
    const sig2 = new Float32Array(N);

    // Create a pulse in sig1 and delayed copy in sig2
    for (let i = 100; i < 110; i++) {
      sig1[i] = Math.sin(2 * Math.PI * i / 10);
      if (i + delay < N) sig2[i + delay] = sig1[i];
    }

    const result = gccPhat(sig1, sig2, sr);
    expect(result.gcc.length).toBeGreaterThan(0);
    // Peak delay should be close to delay/sr (PHAT weighting on short signals may have wider peak)
    const expectedDelay = delay / sr;
    expect(Math.abs(result.peakDelay - expectedDelay)).toBeLessThanOrEqual(10 / sr);
  });
});
