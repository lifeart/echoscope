import { estimateBestFromProfile, pickBestFromProfile } from '../../src/dsp/peak.js';

/**
 * Regression tests for peak detection with weak signals.
 *
 * Bug: strengthGate HTML default (0.003) was 30x higher than store
 * default (0.0001), causing all detections to be gated as "weak".
 * These tests verify peak detection works correctly with small amplitudes.
 */
describe('estimateBestFromProfile with weak signals', () => {
  it('detects peak at typical weak signal level (~1e-4)', () => {
    const prof = new Float32Array(240);
    // Simulate a weak but real echo at bin 100
    prof[100] = 2.5e-4;
    // Add noise floor
    for (let i = 0; i < prof.length; i++) {
      if (i !== 100) prof[i] = 1e-6;
    }

    const result = estimateBestFromProfile(prof, 0.3, 4.0);
    expect(result.bin).toBe(100);
    expect(result.val).toBeCloseTo(2.5e-4, 8);
    expect(result.range).toBeGreaterThan(0.3);
    expect(result.range).toBeLessThan(4.0);
  });

  it('detects peak at very weak signal level (~3e-5)', () => {
    const prof = new Float32Array(240);
    prof[60] = 3e-5;

    const result = estimateBestFromProfile(prof, 0.1, 3.0);
    expect(result.bin).toBe(60);
    expect(result.val).toBeCloseTo(3e-5, 10);
    expect(Number.isFinite(result.range)).toBe(true);
  });

  it('returns -1 for profile at noise floor (< 1e-6)', () => {
    const prof = new Float32Array(240);
    for (let i = 0; i < prof.length; i++) {
      prof[i] = 5e-7; // below the 1e-6 threshold
    }

    const result = estimateBestFromProfile(prof, 0.3, 4.0);
    expect(result.bin).toBe(-1);
    expect(result.val).toBe(0);
  });

  it('val > strengthGate(0.0001) for signal of 2.5e-4', () => {
    const prof = new Float32Array(240);
    prof[120] = 2.5e-4;

    const result = estimateBestFromProfile(prof, 0.3, 4.0);
    const strengthGate = 0.0001;

    // This is the exact check doPing uses
    const isWeak = result.val < strengthGate;
    expect(isWeak).toBe(false);
    expect(result.val).toBeGreaterThan(strengthGate);
  });

  it('val < strengthGate(0.0001) for signal of 3e-5', () => {
    const prof = new Float32Array(240);
    prof[120] = 3e-5;

    const result = estimateBestFromProfile(prof, 0.3, 4.0);
    const strengthGate = 0.0001;

    const isWeak = result.val < strengthGate;
    expect(isWeak).toBe(true);
  });
});

describe('pickBestFromProfile with weak signals', () => {
  it('finds max even at very small amplitudes', () => {
    const prof = new Float32Array(240);
    prof[50] = 1e-8;
    prof[100] = 3e-5;
    prof[200] = 1e-5;

    const result = pickBestFromProfile(prof);
    expect(result.bin).toBe(100);
    expect(result.val).toBeCloseTo(3e-5);
  });

  it('returns 0 val for all-zero profile', () => {
    const prof = new Float32Array(240);
    const result = pickBestFromProfile(prof);
    expect(result.val).toBe(0);
  });
});
