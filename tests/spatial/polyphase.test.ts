import { describe, it, expect } from 'vitest';
import { buildPolyphaseTable, polyphaseInterpolate } from '../../src/spatial/polyphase-table.js';

describe('buildPolyphaseTable', () => {
  it('table has correct dimensions (taps x phases)', () => {
    const taps = 8;
    const phases = 32;
    const table = buildPolyphaseTable(taps, phases, 5.0);

    expect(table.taps).toBe(taps);
    expect(table.phases).toBe(phases);
    expect(table.coeffs.length).toBe(taps * phases);
    expect(table.coeffs).toBeInstanceOf(Float32Array);
  });

  it('phase 0 coefficients sum to ~1', () => {
    const table = buildPolyphaseTable(8, 32, 5.0);
    let sum = 0;
    for (let t = 0; t < table.taps; t++) {
      sum += table.coeffs[0 * table.taps + t]; // phase 0
    }
    expect(sum).toBeCloseTo(1.0, 4);
  });

  it('all phases sum to ~1 (unity gain)', () => {
    const taps = 8;
    const phases = 32;
    const table = buildPolyphaseTable(taps, phases, 5.0);

    for (let p = 0; p < phases; p++) {
      let sum = 0;
      for (let t = 0; t < taps; t++) {
        sum += table.coeffs[p * taps + t];
      }
      expect(sum).toBeCloseTo(1.0, 3);
    }
  });

  it('custom parameters produce table with correct size', () => {
    const taps = 16;
    const phases = 64;
    const table = buildPolyphaseTable(taps, phases, 8.0);

    expect(table.taps).toBe(taps);
    expect(table.phases).toBe(phases);
    expect(table.coeffs.length).toBe(taps * phases);
  });

  it('phase 0 peak coefficients are near the center of the tap range', () => {
    const taps = 8;
    const table = buildPolyphaseTable(taps, 32, 5.0);

    // For even taps, the sinc center (taps-1)/2 = 3.5 falls between taps 3 and 4.
    // Both taps 3 and 4 should have the highest (equal) values.
    const val3 = table.coeffs[0 * taps + 3];
    const val4 = table.coeffs[0 * taps + 4];
    expect(val3).toBeCloseTo(val4, 4);

    // Both should be larger than any other tap
    for (let t = 0; t < taps; t++) {
      if (t === 3 || t === 4) continue;
      expect(table.coeffs[0 * taps + t]).toBeLessThan(val3 + 1e-6);
    }
  });

  it('odd taps have a clear center peak at phase 0', () => {
    // With odd taps, the sinc center falls exactly on a tap
    const taps = 7;
    const table = buildPolyphaseTable(taps, 32, 5.0);
    const centerTap = (taps - 1) / 2; // = 3

    let maxVal = 0;
    let maxTap = 0;
    for (let t = 0; t < taps; t++) {
      const val = table.coeffs[0 * taps + t];
      if (val > maxVal) { maxVal = val; maxTap = t; }
    }
    expect(maxTap).toBe(centerTap);
  });
});

describe('polyphaseInterpolate', () => {
  it('zero delay with constant input produces constant output', () => {
    const table = buildPolyphaseTable(8, 32, 5.0);
    const len = 64;
    const input = new Float32Array(len);
    const output = new Float32Array(len);

    // Constant input = DC signal, should be preserved regardless of filter shape
    for (let i = 0; i < len; i++) input[i] = 1.0;

    polyphaseInterpolate(input, 0, table, output);

    // Interior samples should be ~1.0 (unity gain guaranteed)
    const halfTaps = Math.floor((table.taps - 1) / 2);
    for (let i = halfTaps + 1; i < len - halfTaps - 2; i++) {
      expect(output[i]).toBeCloseTo(1.0, 2);
    }
  });

  it('integer delay shifts impulse by the correct amount', () => {
    const table = buildPolyphaseTable(8, 32, 5.0);
    const len = 128;
    const input = new Float32Array(len);
    const output0 = new Float32Array(len);
    const output5 = new Float32Array(len);

    // Create an impulse
    const impulseLoc = 60;
    input[impulseLoc] = 1.0;

    // Measure the peak position with delay=0 as baseline
    polyphaseInterpolate(input, 0, table, output0);
    let peak0Idx = 0, peak0Val = 0;
    for (let i = 0; i < len; i++) {
      if (Math.abs(output0[i]) > peak0Val) {
        peak0Val = Math.abs(output0[i]);
        peak0Idx = i;
      }
    }

    // Now apply integer delay=5
    const intDelay = 5;
    polyphaseInterpolate(input, intDelay, table, output5);
    let peak5Idx = 0, peak5Val = 0;
    for (let i = 0; i < len; i++) {
      if (Math.abs(output5[i]) > peak5Val) {
        peak5Val = Math.abs(output5[i]);
        peak5Idx = i;
      }
    }

    // The difference in peak positions should equal the integer delay
    expect(peak5Idx - peak0Idx).toBe(intDelay);
  });

  it('fractional delay preserves sinusoidal shape', () => {
    const table = buildPolyphaseTable(8, 32, 5.0);
    const sr = 1000; // sample rate
    const freq = 20; // Hz - well below Nyquist (Nyquist = 500 Hz)
    const len = 512;
    const input = new Float32Array(len);
    const output = new Float32Array(len);

    // Generate a sine wave
    for (let i = 0; i < len; i++) {
      input[i] = Math.sin(2 * Math.PI * freq * i / sr);
    }

    const delay = 3.5;
    polyphaseInterpolate(input, delay, table, output);

    // The output should also be sinusoidal with the same frequency.
    // Measure by fitting: find the actual delay by cross-correlating a portion.
    // Simpler: just check that the output amplitude is close to 1 in the interior.
    const halfTaps = Math.floor((table.taps - 1) / 2);
    const start = halfTaps + 20;
    const end = len - halfTaps - 20;

    let maxAbs = 0;
    for (let i = start; i < end; i++) {
      const a = Math.abs(output[i]);
      if (a > maxAbs) maxAbs = a;
    }

    // Amplitude should be close to 1.0 (unity gain for low-frequency sinusoid)
    expect(maxAbs).toBeGreaterThan(0.9);
    expect(maxAbs).toBeLessThan(1.1);
  });

  it('relative delay between two signals is accurate', () => {
    // Use two different delays and measure relative shift via cross-correlation
    const table = buildPolyphaseTable(8, 32, 5.0);
    const sr = 1000;
    const freq = 30;
    const len = 512;
    const input = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      input[i] = Math.sin(2 * Math.PI * freq * i / sr);
    }

    const outputA = new Float32Array(len);
    const outputB = new Float32Array(len);
    polyphaseInterpolate(input, 2.0, table, outputA);
    polyphaseInterpolate(input, 5.0, table, outputB);

    // The relative delay should be 3.0 samples.
    // Measure phase difference in the interior by fitting sine waves.
    const halfTaps = Math.floor((table.taps - 1) / 2);
    const start = halfTaps + 30;
    const end = len - halfTaps - 30;

    // Cross-correlate outputA and outputB to find lag
    let bestLag = 0;
    let bestCorr = -Infinity;
    for (let lag = 0; lag <= 6; lag++) {
      let sum = 0;
      for (let i = start; i < end - 6; i++) {
        sum += outputA[i] * outputB[i + lag];
      }
      if (sum > bestCorr) { bestCorr = sum; bestLag = lag; }
    }

    // The best integer lag should be 3 (closest to the 3.0-sample relative delay)
    expect(bestLag).toBe(3);
  });

  it('output buffer has same length as input', () => {
    const table = buildPolyphaseTable(8, 32, 5.0);
    const input = new Float32Array(100);
    const output = new Float32Array(100);

    polyphaseInterpolate(input, 1.5, table, output);
    expect(output.length).toBe(input.length);
  });

  it('handles zero-length input gracefully', () => {
    const table = buildPolyphaseTable(8, 32, 5.0);
    const input = new Float32Array(0);
    const output = new Float32Array(0);

    // Should not throw
    polyphaseInterpolate(input, 0, table, output);
    expect(output.length).toBe(0);
  });

  it('large delay shifts signal beyond buffer (output near zero)', () => {
    const table = buildPolyphaseTable(8, 32, 5.0);
    const len = 32;
    const input = new Float32Array(len);
    const output = new Float32Array(len);

    // Put signal in the first few samples
    for (let i = 0; i < 5; i++) input[i] = 1.0;

    // Delay larger than buffer
    polyphaseInterpolate(input, len + 10, table, output);

    // All output samples should be zero (signal shifted entirely out of range)
    for (let i = 0; i < len; i++) {
      expect(output[i]).toBe(0);
    }
  });
});
