/**
 * Tests for Fix #6: Coherent integration FFT phase-ramp shifting.
 *
 * Verifies that fftFractionalShift applies exact sub-sample shifts
 * using the frequency-domain phase ramp X[k]·e^{-j2πkΔ/N}, which is
 * superior to linear interpolation for band-limited signals.
 */
import { describe, it, expect } from 'vitest';
import { fftFractionalShift } from '../../src/scan/scan-engine.js';

describe('fftFractionalShift', () => {
  it('zero shift returns identical signal', () => {
    const real = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const imag = new Float32Array(8);

    const result = fftFractionalShift(real, imag, 0);
    for (let i = 0; i < real.length; i++) {
      expect(result.real[i]).toBeCloseTo(real[i], 6);
      expect(result.imag[i]).toBeCloseTo(0, 6);
    }
  });

  it('integer shift moves samples exactly', () => {
    const N = 8;
    const real = new Float32Array(N);
    real[0] = 1; // impulse at sample 0
    const imag = new Float32Array(N);

    // Shift by 2 samples — impulse should move to sample 2
    const result = fftFractionalShift(real, imag, 2);

    // Due to circular nature of FFT, the impulse wraps
    // The peak should be at index 2
    let maxIdx = 0, maxVal = -Infinity;
    for (let i = 0; i < N; i++) {
      const mag = Math.abs(result.real[i]);
      if (mag > maxVal) { maxVal = mag; maxIdx = i; }
    }
    expect(maxIdx).toBe(2);
    expect(maxVal).toBeCloseTo(1, 3);
  });

  it('fractional shift preserves energy', () => {
    const N = 16;
    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      real[i] = Math.sin(2 * Math.PI * 2 * i / N);
    }

    const energyBefore = real.reduce((s, v) => s + v * v, 0);
    const result = fftFractionalShift(real, imag, 1.5);

    const energyAfter = result.real.reduce((s, v) => s + v * v, 0) +
                        result.imag.reduce((s, v) => s + v * v, 0);
    expect(energyAfter).toBeCloseTo(energyBefore, 3);
  });

  it('shifts a complex exponential by correct phase', () => {
    // Use a complex exponential e^{j2π·freq·n/N} which has a single DFT bin,
    // avoiding Hermitian symmetry issues with real-signal fractional shifts.
    const N = 32;
    const freq = 3;
    const real = new Float32Array(N);
    const imag = new Float32Array(N);

    for (let i = 0; i < N; i++) {
      real[i] = Math.cos(2 * Math.PI * freq * i / N);
      imag[i] = Math.sin(2 * Math.PI * freq * i / N);
    }

    const shift = 2.7;
    const result = fftFractionalShift(real, imag, shift);

    // After shifting, x'[n] = e^{j2π·freq·(n-shift)/N}
    for (let i = 0; i < N; i++) {
      const phase = 2 * Math.PI * freq * (i - shift) / N;
      const expectedR = Math.cos(phase);
      const expectedI = Math.sin(phase);
      expect(result.real[i]).toBeCloseTo(expectedR, 3);
      expect(result.imag[i]).toBeCloseTo(expectedI, 3);
    }
  });

  it('handles empty arrays', () => {
    const result = fftFractionalShift(new Float32Array(0), new Float32Array(0), 1.5);
    expect(result.real.length).toBe(0);
    expect(result.imag.length).toBe(0);
  });

  it('handles complex input', () => {
    const N = 8;
    const real = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]);
    const imag = new Float32Array([0, 1, 0, 0, 0, 0, 0, 0]);

    // Should not throw
    const result = fftFractionalShift(real, imag, 0.5);
    expect(result.real.length).toBe(N);
    expect(result.imag.length).toBe(N);

    // Energy should be preserved
    const eBefore = real.reduce((s, v, i) => s + v * v + imag[i] * imag[i], 0);
    const eAfter = result.real.reduce((s, v, i) => s + v * v + result.imag[i] * result.imag[i], 0);
    expect(eAfter).toBeCloseTo(eBefore, 3);
  });
});
