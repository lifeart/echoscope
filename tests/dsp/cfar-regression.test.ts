import { describe, it, expect } from 'vitest';
import { caCfar } from '../../src/dsp/cfar.js';

describe('CFAR regression', () => {
  it('does not reject echoes that fixed gate would accept', () => {
    // A weak but real echo peak at 0.001 with noise at 0.0001 should be detected.
    // A fixed threshold at e.g. 0.0005 would accept it; CFAR should too since
    // the peak is 10x above the local noise floor.
    const len = 200;
    const profile = new Float32Array(len);
    for (let i = 0; i < len; i++) profile[i] = 0.0001;
    profile[100] = 0.001;

    const result = caCfar(profile, {
      guardCells: 2,
      trainingCells: 8,
      pfa: 1e-3,
      minThreshold: 1e-8,
    });

    expect(result.detections[100]).toBe(1);
  });

  it('adapts to varying noise floors across profile', () => {
    // Left half has noise = 0.01, right half has noise = 0.1
    // A peak in the left half at 0.1 should be detected relative to left-half noise.
    // A peak in the right half at 1.0 should be detected relative to right-half noise.
    const len = 400;
    const profile = new Float32Array(len);

    // Left half: low noise
    for (let i = 0; i < 200; i++) profile[i] = 0.01;
    // Right half: high noise
    for (let i = 200; i < 400; i++) profile[i] = 0.1;

    // Peaks well above their respective noise floors
    const leftPeakIdx = 50;
    const rightPeakIdx = 300;
    profile[leftPeakIdx] = 0.1;   // 10x above left noise
    profile[rightPeakIdx] = 1.0;  // 10x above right noise

    const result = caCfar(profile, {
      guardCells: 2,
      trainingCells: 16,
      pfa: 1e-3,
      minThreshold: 1e-8,
    });

    expect(result.detections[leftPeakIdx]).toBe(1);
    expect(result.detections[rightPeakIdx]).toBe(1);
  });

  it('detects echo below strengthGate when above local noise floor', () => {
    // An echo at 0.00008 is below strengthGate=0.0001, but CFAR should detect it
    // because it's well above the local noise floor of 0.000005.
    const len = 200;
    const profile = new Float32Array(len);
    for (let i = 0; i < len; i++) profile[i] = 0.000005;
    profile[100] = 0.00008; // Below strengthGate=0.0001, but 16x above noise

    const result = caCfar(profile, {
      guardCells: 2,
      trainingCells: 8,
      pfa: 1e-3,
      minThreshold: 1e-10,
    });

    // CFAR should detect this because it's far above local noise floor
    expect(result.detections[100]).toBe(1);
  });

  it('does not false-detect at noise-floor transitions', () => {
    // Where noise floor jumps from 0.01 to 0.1, edge cells see mixed training windows.
    // Cells at exactly the noise level should NOT be detected.
    const len = 200;
    const profile = new Float32Array(len);
    for (let i = 0; i < 100; i++) profile[i] = 0.01;
    for (let i = 100; i < 200; i++) profile[i] = 0.1;

    const result = caCfar(profile, {
      guardCells: 2,
      trainingCells: 8,
      pfa: 1e-3,
      minThreshold: 1e-8,
    });

    // Cells deep in the right half at exactly 0.1 should not be detected
    // (they are at the noise floor, not above it)
    expect(result.detections[150]).toBe(0);
    expect(result.detections[170]).toBe(0);
  });
});
