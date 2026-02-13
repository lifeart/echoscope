import { describe, it, expect } from 'vitest';
import { findProfilePeak, estimateProfileNoiseFloor } from '../../src/viz/profile-plot.js';

describe('findProfilePeak', () => {
  it('returns correct range for single peak', () => {
    const sr = 48000;
    const tau0 = 0;
    const c = 343;
    const minTau = 0;
    const maxTau = 0.01; // 10 ms window

    // Create correlation with a single peak at sample 240
    // tau = 240 / 48000 = 0.005 s
    // range = c * tau / 2 = 343 * 0.005 / 2 = 0.8575 m
    const corr = new Float32Array(480);
    corr[240] = 0.9;

    const result = findProfilePeak(corr, sr, tau0, minTau, maxTau, c);

    expect(result).not.toBeNull();
    expect(result!.index).toBe(240);
    expect(result!.amplitude).toBeCloseTo(0.9);
    expect(result!.range).toBeCloseTo(c * (240 / sr) / 2);
  });

  it('returns strongest when multiple peaks', () => {
    const sr = 48000;
    const tau0 = 0;
    const c = 343;
    const minTau = 0;
    const maxTau = 0.01;

    const corr = new Float32Array(480);
    corr[100] = 0.5; // weaker peak
    corr[300] = 0.8; // stronger peak

    const result = findProfilePeak(corr, sr, tau0, minTau, maxTau, c);

    expect(result).not.toBeNull();
    expect(result!.index).toBe(300);
    expect(result!.amplitude).toBeCloseTo(0.8);
  });

  it('returns null for zero correlation', () => {
    const sr = 48000;
    const tau0 = 0;
    const c = 343;
    const minTau = 0;
    const maxTau = 0.01;

    const corr = new Float32Array(480); // all zeros

    const result = findProfilePeak(corr, sr, tau0, minTau, maxTau, c);
    expect(result).toBeNull();
  });

  it('considers negative peaks by absolute value', () => {
    const sr = 48000;
    const tau0 = 0;
    const c = 343;
    const minTau = 0;
    const maxTau = 0.01;

    const corr = new Float32Array(480);
    corr[100] = 0.5;
    corr[200] = -0.9; // larger absolute value

    const result = findProfilePeak(corr, sr, tau0, minTau, maxTau, c);

    expect(result).not.toBeNull();
    expect(result!.index).toBe(200);
    expect(result!.amplitude).toBeCloseTo(0.9);
  });

  it('respects tau window boundaries', () => {
    const sr = 48000;
    const tau0 = 0;
    const c = 343;
    const minTau = 0.005;
    const maxTau = 0.008;

    const corr = new Float32Array(480);
    // Sample 100: tau = 100/48000 = 0.00208 -> outside window
    corr[100] = 1.0;
    // Sample 300: tau = 300/48000 = 0.00625 -> inside window
    corr[300] = 0.5;

    const result = findProfilePeak(corr, sr, tau0, minTau, maxTau, c);

    expect(result).not.toBeNull();
    expect(result!.index).toBe(300);
    expect(result!.amplitude).toBeCloseTo(0.5);
  });
});

describe('estimateProfileNoiseFloor', () => {
  it('returns median of abs values', () => {
    const sr = 48000;
    const tau0 = 0;
    const minTau = 0;
    const maxTau = 0.01;

    // Create correlation with known distribution of absolute values
    const corr = new Float32Array(480);
    // Place values at samples that fall within the tau window [0, 0.01]
    // Samples 0..479 -> tau = 0..0.009979 (all within window)
    // Set 5 values: abs values will be [0.1, 0.2, 0.3, 0.4, 0.5]
    // Median of sorted = 0.3
    corr[10] = 0.1;
    corr[20] = 0.3;
    corr[30] = -0.5; // abs = 0.5
    corr[40] = 0.2;
    corr[50] = -0.4; // abs = 0.4

    const noise = estimateProfileNoiseFloor(corr, sr, tau0, minTau, maxTau);

    // Only non-zero values are collected: [0.1, 0.3, 0.5, 0.2, 0.4]
    // Sorted: [0.1, 0.2, 0.3, 0.4, 0.5]
    // Median (floor(5/2) = index 2) = 0.3
    expect(noise).toBeCloseTo(0.3);
  });

  it('returns 0 for empty window', () => {
    const sr = 48000;
    const tau0 = 0;

    // minTau > maxTau -> no samples in window
    const corr = new Float32Array(480);
    corr[100] = 0.5;

    const noise = estimateProfileNoiseFloor(corr, sr, tau0, 0.02, 0.01);
    expect(noise).toBe(0);
  });

  it('returns 0 for all-zero correlation', () => {
    const sr = 48000;
    const tau0 = 0;
    const minTau = 0;
    const maxTau = 0.01;

    const corr = new Float32Array(480); // all zeros

    const noise = estimateProfileNoiseFloor(corr, sr, tau0, minTau, maxTau);
    expect(noise).toBe(0);
  });

  it('ignores samples outside tau window', () => {
    const sr = 48000;
    const tau0 = 0;
    const minTau = 0.005;
    const maxTau = 0.008;

    const corr = new Float32Array(480);
    // Sample 100: tau = 0.00208 -> outside
    corr[100] = 10.0;
    // Sample 300: tau = 0.00625 -> inside
    corr[300] = 0.2;
    // Sample 350: tau = 0.00729 -> inside
    corr[350] = 0.4;

    const noise = estimateProfileNoiseFloor(corr, sr, tau0, minTau, maxTau);

    // Only values within window: [0.2, 0.4]
    // Sorted: [0.2, 0.4], floor(2/2) = index 1 -> 0.4
    expect(noise).toBeCloseTo(0.4);
  });
});
