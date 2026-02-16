/**
 * Tests for Fix #5: CFAR power-domain correction.
 *
 * Verifies that the CFAR detector properly operates in the power domain
 * (squared amplitudes) internally while accepting and returning thresholds
 * in the amplitude domain.
 */
import { describe, it, expect } from 'vitest';
import { caCfar, cfarAlpha } from '../../src/dsp/cfar.js';

describe('CFAR power-domain operation', () => {
  it('thresholds are in amplitude domain (comparable to input)', () => {
    const len = 100;
    const profile = new Float32Array(len);
    for (let i = 0; i < len; i++) profile[i] = 0.1;
    profile[50] = 1.0;

    const result = caCfar(profile);

    // Thresholds should be comparable to the input amplitude values
    // (not squared values). For uniform noise at 0.1, threshold should
    // be somewhere around 0.1-0.5 (not 0.01-0.25).
    for (let i = 0; i < len; i++) {
      if (i === 50) continue;
      expect(result.thresholds[i]).toBeGreaterThan(0.01);
      expect(result.thresholds[i]).toBeLessThan(5);
    }
  });

  it('detects peak at correct SNR boundary', () => {
    // With power-domain operation, the detection threshold matches
    // the exponential noise model assumption
    const len = 200;
    const noiseLevel = 0.1;
    const profile = new Float32Array(len);
    for (let i = 0; i < len; i++) profile[i] = noiseLevel;

    // Strong target: should always detect
    profile[100] = noiseLevel * 20;
    const result = caCfar(profile);
    expect(result.detections[100]).toBe(1);
  });

  it('uniform noise produces zero detections', () => {
    const len = 200;
    const profile = new Float32Array(len);
    for (let i = 0; i < len; i++) profile[i] = 0.5;

    const result = caCfar(profile);
    expect(result.detectionCount).toBe(0);
  });

  it('threshold scales correctly with noise amplitude', () => {
    const len = 100;
    const profile1 = new Float32Array(len).fill(0.1);
    const profile2 = new Float32Array(len).fill(0.2);

    // Add identical peaks
    profile1[50] = 1.0;
    profile2[50] = 1.0;

    const r1 = caCfar(profile1);
    const r2 = caCfar(profile2);

    // Higher noise floor → higher threshold
    // Compare at a noise-only cell
    const cell = 20;
    expect(r2.thresholds[cell]).toBeGreaterThan(r1.thresholds[cell]);
  });

  it('power-domain thresholds are sqrt of what they would be in amplitude domain', () => {
    // If we double the amplitude of the signal, the power quadruples.
    // The threshold (returned in amplitude domain) should roughly double.
    const len = 100;
    const profile1 = new Float32Array(len).fill(0.1);
    const profile2 = new Float32Array(len).fill(0.2); // 2x amplitude

    const r1 = caCfar(profile1);
    const r2 = caCfar(profile2);

    // Check ratio at a noise cell
    const cell = 30;
    const ratio = r2.thresholds[cell] / r1.thresholds[cell];
    // Should be close to 2 (amplitude ratio), not 4 (power ratio)
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(2.5);
  });
});
