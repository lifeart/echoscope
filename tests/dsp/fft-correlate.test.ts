import { fftCorrelate } from '../../src/dsp/fft-correlate.js';
import { correlate } from '../../src/dsp/correlate.js';

describe('fftCorrelate', () => {
  it('produces same peak location as time-domain correlate', () => {
    // Create a signal with a delayed copy of reference
    const ref = new Float32Array(32);
    for (let i = 0; i < 32; i++) ref[i] = Math.sin(2 * Math.PI * i / 8);

    const signal = new Float32Array(128);
    const delay = 40;
    for (let i = 0; i < ref.length; i++) {
      signal[delay + i] = ref[i];
    }

    const tdResult = correlate(signal, ref);
    const fftResult = fftCorrelate(signal, ref, 48000);

    // Find peaks
    let tdPeak = 0, fftPeak = 0;
    let tdMax = -Infinity, fftMax = -Infinity;
    for (let i = 0; i < tdResult.length; i++) {
      if (tdResult[i] > tdMax) { tdMax = tdResult[i]; tdPeak = i; }
    }
    for (let i = 0; i < fftResult.correlation.length; i++) {
      if (fftResult.correlation[i] > fftMax) { fftMax = fftResult.correlation[i]; fftPeak = i; }
    }

    expect(fftPeak).toBe(tdPeak);
  });

  it('returns fft method tag', () => {
    const result = fftCorrelate(new Float32Array(64), new Float32Array(16), 48000);
    expect(result.method).toBe('fft');
  });
});
