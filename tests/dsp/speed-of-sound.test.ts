/**
 * Tests for Fix #4: Speed of sound sqrt model with humidity correction.
 */
import { describe, it, expect } from 'vitest';
import { speedOfSoundFromTemp, SPEED_OF_SOUND } from '../../src/constants.js';

describe('speedOfSoundFromTemp', () => {
  it('matches known value at 0°C dry air', () => {
    // At 0°C, 0% humidity: c = 331.3 * sqrt(1) * (1 + 0) = 331.3
    const c = speedOfSoundFromTemp(0, 0);
    expect(c).toBeCloseTo(331.3, 1);
  });

  it('matches known value at 20°C', () => {
    const c = speedOfSoundFromTemp(20, 50);
    const expected = 331.3 * Math.sqrt(1 + 20 / 273.15) * (1 + 0.00006 * 50);
    expect(c).toBeCloseTo(expected, 6);
    // Should be in the ballpark of 343-344 m/s
    expect(c).toBeGreaterThan(342);
    expect(c).toBeLessThan(346);
  });

  it('matches known value at 25°C (default)', () => {
    const c = speedOfSoundFromTemp(25);
    const expected = 331.3 * Math.sqrt(1 + 25 / 273.15) * (1 + 0.00006 * 50);
    expect(c).toBeCloseTo(expected, 6);
    expect(SPEED_OF_SOUND).toBeCloseTo(c, 6);
  });

  it('increases with temperature', () => {
    const c0 = speedOfSoundFromTemp(0, 50);
    const c20 = speedOfSoundFromTemp(20, 50);
    const c40 = speedOfSoundFromTemp(40, 50);
    expect(c20).toBeGreaterThan(c0);
    expect(c40).toBeGreaterThan(c20);
  });

  it('increases with humidity', () => {
    const cDry = speedOfSoundFromTemp(20, 0);
    const cMid = speedOfSoundFromTemp(20, 50);
    const cWet = speedOfSoundFromTemp(20, 100);
    expect(cMid).toBeGreaterThan(cDry);
    expect(cWet).toBeGreaterThan(cMid);
  });

  it('humidity effect is bounded (~0.6% at 100% RH)', () => {
    const cDry = speedOfSoundFromTemp(20, 0);
    const cWet = speedOfSoundFromTemp(20, 100);
    const pctDiff = (cWet - cDry) / cDry * 100;
    // 0.00006 * 100 = 0.006 → 0.6% correction
    expect(pctDiff).toBeCloseTo(0.6, 0);
    expect(pctDiff).toBeLessThan(1);
  });

  it('clamps humidity to [0, 100]', () => {
    const cNeg = speedOfSoundFromTemp(20, -50);
    const c0 = speedOfSoundFromTemp(20, 0);
    expect(cNeg).toBeCloseTo(c0, 6);

    const c150 = speedOfSoundFromTemp(20, 150);
    const c100 = speedOfSoundFromTemp(20, 100);
    expect(c150).toBeCloseTo(c100, 6);
  });

  it('default humidity is 50%', () => {
    const cDefault = speedOfSoundFromTemp(20);
    const cExplicit = speedOfSoundFromTemp(20, 50);
    expect(cDefault).toBe(cExplicit);
  });

  it('non-linear: differs from old linear model by measurable amount', () => {
    const linear = 331.3 + 0.606 * 40;
    const sqrtModel = speedOfSoundFromTemp(40, 0);
    // At 40°C, the two models diverge by ~0.1-0.3 m/s
    expect(Math.abs(sqrtModel - linear)).toBeGreaterThan(0.01);
  });
});
