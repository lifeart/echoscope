import { designBandpass, applyBandpass } from '../../src/dsp/bandpass.js';

describe('designBandpass', () => {
  const sr = 48000;

  it('produces odd-length symmetric taps', () => {
    const coeffs = designBandpass(900, 2500, sr, 128); // even → forced odd
    expect(coeffs.taps.length % 2).toBe(1);
    expect(coeffs.taps.length).toBe(129);
    // Symmetric (linear-phase type I)
    const N = coeffs.taps.length;
    for (let i = 0; i < Math.floor(N / 2); i++) {
      expect(Math.abs(coeffs.taps[i] - coeffs.taps[N - 1 - i])).toBeLessThan(1e-10);
    }
  });

  it('has correct group delay', () => {
    const coeffs = designBandpass(900, 2500, sr, 129);
    expect(coeffs.groupDelay).toBe(64);
  });

  it('stores band parameters', () => {
    const coeffs = designBandpass(900, 2500, sr, 129);
    expect(coeffs.fLow).toBe(900);
    expect(coeffs.fHigh).toBe(2500);
    expect(coeffs.sampleRate).toBe(sr);
  });

  it('passband has unity gain at center frequency', () => {
    const coeffs = designBandpass(900, 2500, sr, 129);
    const fCenter = (900 + 2500) / 2;
    const half = coeffs.groupDelay;
    // Compute frequency response at center frequency
    let real = 0, imag = 0;
    for (let n = 0; n < coeffs.taps.length; n++) {
      const w = 2 * Math.PI * (fCenter / sr) * (n - half);
      real += coeffs.taps[n] * Math.cos(w);
      imag += coeffs.taps[n] * Math.sin(w);
    }
    const mag = Math.sqrt(real * real + imag * imag);
    expect(Math.abs(mag - 1.0)).toBeLessThan(0.05);
  });

  it('stopband is attenuated below cutoff', () => {
    const coeffs = designBandpass(900, 2500, sr, 129);
    const half = coeffs.groupDelay;
    // Check attenuation at 200 Hz (well below passband)
    let real = 0, imag = 0;
    for (let n = 0; n < coeffs.taps.length; n++) {
      const w = 2 * Math.PI * (200 / sr) * (n - half);
      real += coeffs.taps[n] * Math.cos(w);
      imag += coeffs.taps[n] * Math.sin(w);
    }
    const mag = Math.sqrt(real * real + imag * imag);
    expect(mag).toBeLessThan(0.1); // >20dB attenuation
  });

  it('stopband is attenuated above cutoff', () => {
    const coeffs = designBandpass(900, 2500, sr, 129);
    const half = coeffs.groupDelay;
    // Check attenuation at 8000 Hz (well above passband)
    let real = 0, imag = 0;
    for (let n = 0; n < coeffs.taps.length; n++) {
      const w = 2 * Math.PI * (8000 / sr) * (n - half);
      real += coeffs.taps[n] * Math.cos(w);
      imag += coeffs.taps[n] * Math.sin(w);
    }
    const mag = Math.sqrt(real * real + imag * imag);
    expect(mag).toBeLessThan(0.1);
  });
});

describe('applyBandpass', () => {
  const sr = 48000;

  it('preserves signal length', () => {
    const coeffs = designBandpass(900, 2500, sr, 129);
    const signal = new Float32Array(4800); // 100ms
    for (let i = 0; i < signal.length; i++) {
      signal[i] = Math.sin(2 * Math.PI * 1500 * i / sr); // 1500 Hz (in-band)
    }
    const filtered = applyBandpass(signal, coeffs);
    expect(filtered.length).toBe(signal.length);
  });

  it('passes in-band sinusoid with near-unity gain', () => {
    const coeffs = designBandpass(900, 2500, sr, 129);
    const freq = 1700; // center of band
    const signal = new Float32Array(9600); // 200ms for settling
    for (let i = 0; i < signal.length; i++) {
      signal[i] = Math.sin(2 * Math.PI * freq * i / sr);
    }
    const filtered = applyBandpass(signal, coeffs);

    // Check steady-state amplitude (skip transient at start)
    const startSample = 4800; // after 100ms
    let maxAmp = 0;
    for (let i = startSample; i < filtered.length; i++) {
      maxAmp = Math.max(maxAmp, Math.abs(filtered[i]));
    }
    expect(maxAmp).toBeGreaterThan(0.8);
    expect(maxAmp).toBeLessThan(1.2);
  });

  it('attenuates out-of-band sinusoid', () => {
    const coeffs = designBandpass(900, 2500, sr, 129);
    const freq = 200; // well below band
    const signal = new Float32Array(9600);
    for (let i = 0; i < signal.length; i++) {
      signal[i] = Math.sin(2 * Math.PI * freq * i / sr);
    }
    const filtered = applyBandpass(signal, coeffs);

    // Check amplitude is strongly attenuated
    const startSample = 4800;
    let maxAmp = 0;
    for (let i = startSample; i < filtered.length; i++) {
      maxAmp = Math.max(maxAmp, Math.abs(filtered[i]));
    }
    expect(maxAmp).toBeLessThan(0.15);
  });

  it('L/R filtering preserves deltaTau', () => {
    const coeffs = designBandpass(900, 2500, sr, 129);
    const freq = 1700;
    const delaysamples = 5; // ~0.1ms delay

    const sigL = new Float32Array(9600);
    const sigR = new Float32Array(9600);
    for (let i = 0; i < 9600; i++) {
      sigL[i] = Math.sin(2 * Math.PI * freq * i / sr);
      const shifted = i - delaysamples;
      sigR[i] = shifted >= 0 ? Math.sin(2 * Math.PI * freq * shifted / sr) : 0;
    }

    const filtL = applyBandpass(sigL, coeffs);
    const filtR = applyBandpass(sigR, coeffs);

    // Find peaks in steady state and verify delay is preserved
    // Cross-correlate filtered L and R in a small window
    const win = 480; // 10ms
    const start = 4800;
    let bestLag = 0, bestCorr = -Infinity;
    for (let lag = -20; lag <= 20; lag++) {
      let sum = 0;
      for (let i = 0; i < win; i++) {
        const j = start + i;
        const k = j + lag;
        if (k >= 0 && k < filtR.length) {
          sum += filtL[j] * filtR[k];
        }
      }
      if (sum > bestCorr) { bestCorr = sum; bestLag = lag; }
    }
    // Delay should be close to the original delaysamples
    expect(Math.abs(bestLag - delaysamples)).toBeLessThanOrEqual(1);
  });
});
