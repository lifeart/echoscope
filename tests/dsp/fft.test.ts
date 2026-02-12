import { fft, ifft, nextPow2, zeroPad } from '../../src/dsp/fft.js';

describe('nextPow2', () => {
  it('returns correct powers', () => {
    expect(nextPow2(1)).toBe(1);
    expect(nextPow2(2)).toBe(2);
    expect(nextPow2(3)).toBe(4);
    expect(nextPow2(5)).toBe(8);
    expect(nextPow2(1024)).toBe(1024);
    expect(nextPow2(1025)).toBe(2048);
  });
});

describe('zeroPad', () => {
  it('pads to target length', () => {
    const s = new Float32Array([1, 2, 3]);
    const padded = zeroPad(s, 8);
    expect(padded.length).toBe(8);
    expect(padded[0]).toBe(1);
    expect(padded[2]).toBe(3);
    expect(padded[3]).toBe(0);
  });

  it('returns original if already long enough', () => {
    const s = new Float32Array([1, 2, 3]);
    expect(zeroPad(s, 2)).toBe(s);
  });
});

describe('fft/ifft roundtrip', () => {
  it('recovers original signal', () => {
    const N = 8;
    const real = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const imag = new Float32Array(N);
    const origReal = new Float32Array(real);

    fft(real, imag);
    ifft(real, imag);

    for (let i = 0; i < N; i++) {
      expect(Math.abs(real[i] - origReal[i])).toBeLessThan(1e-5);
    }
  });

  it('computes known DFT for DC signal', () => {
    const N = 4;
    const real = new Float32Array([1, 1, 1, 1]);
    const imag = new Float32Array(N);

    fft(real, imag);

    // DC component should be N, all others 0
    expect(Math.abs(real[0] - 4)).toBeLessThan(1e-5);
    expect(Math.abs(real[1])).toBeLessThan(1e-5);
    expect(Math.abs(real[2])).toBeLessThan(1e-5);
  });

  it('computes known DFT for alternating signal', () => {
    const N = 4;
    const real = new Float32Array([1, -1, 1, -1]);
    const imag = new Float32Array(N);

    fft(real, imag);

    // Nyquist component should be N
    expect(Math.abs(real[0])).toBeLessThan(1e-5);
    expect(Math.abs(real[2] - 4)).toBeLessThan(1e-5);
  });
});
