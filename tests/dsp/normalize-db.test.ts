import { describe, it, expect } from 'vitest';
import { linearToDbNormalized } from '../../src/dsp/normalize.js';

describe('linearToDbNormalized', () => {
  it('returns 0 at noise floor', () => {
    // amplitude == noiseFloor => 20*log10(1) = 0 dB => 0/40 = 0
    expect(linearToDbNormalized(0.01, 0.01)).toBe(0);
  });

  it('returns 0 below noise floor', () => {
    // amplitude < noiseFloor => negative dB => clamped to 0
    expect(linearToDbNormalized(0.005, 0.01)).toBe(0);
  });

  it('returns 1.0 at dynamic range top', () => {
    // For 40 dB range: amplitude = noiseFloor * 10^(40/20) = noiseFloor * 100
    const noiseFloor = 0.01;
    const amplitude = noiseFloor * 100; // 10^(40/20) = 100
    expect(linearToDbNormalized(amplitude, noiseFloor, 40)).toBeCloseTo(1.0);
  });

  it('returns 0.5 at half dynamic range (20dB/40dB)', () => {
    // amplitude = noiseFloor * 10^(20/20) = noiseFloor * 10
    const noiseFloor = 0.01;
    const amplitude = noiseFloor * 10; // 20 dB above noise floor
    expect(linearToDbNormalized(amplitude, noiseFloor, 40)).toBeCloseTo(0.5);
  });

  it('clamps above 1.0', () => {
    // amplitude much larger than dynamic range top
    const noiseFloor = 0.01;
    const amplitude = noiseFloor * 10000; // 80 dB above noise floor
    expect(linearToDbNormalized(amplitude, noiseFloor, 40)).toBe(1);
  });

  it('handles zero/negative inputs', () => {
    // amplitude <= 0
    expect(linearToDbNormalized(0, 0.01)).toBe(0);
    expect(linearToDbNormalized(-1, 0.01)).toBe(0);

    // noiseFloor <= 0
    expect(linearToDbNormalized(0.5, 0)).toBe(0);
    expect(linearToDbNormalized(0.5, -0.01)).toBe(0);

    // Both zero
    expect(linearToDbNormalized(0, 0)).toBe(0);
  });

  it('scales correctly with different dynamic ranges', () => {
    const noiseFloor = 0.001;

    // With 60 dB range: amplitude = noiseFloor * 10^(30/20) ~= noiseFloor * 31.623
    // should give 30/60 = 0.5
    const amplitude30dB = noiseFloor * Math.pow(10, 30 / 20);
    expect(linearToDbNormalized(amplitude30dB, noiseFloor, 60)).toBeCloseTo(0.5);

    // With 60 dB range: amplitude = noiseFloor * 10^(60/20) = noiseFloor * 1000
    // should give 60/60 = 1.0
    const amplitude60dB = noiseFloor * 1000;
    expect(linearToDbNormalized(amplitude60dB, noiseFloor, 60)).toBeCloseTo(1.0);

    // With 60 dB range: amplitude = noiseFloor * 10^(15/20)
    // should give 15/60 = 0.25
    const amplitude15dB = noiseFloor * Math.pow(10, 15 / 20);
    expect(linearToDbNormalized(amplitude15dB, noiseFloor, 60)).toBeCloseTo(0.25);
  });
});
