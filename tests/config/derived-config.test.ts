import { describe, it, expect } from 'vitest';
import { computeDerivedConfig } from '../../src/ui/controls.js';

describe('computeDerivedConfig', () => {
  // speedOfSound
  it('computes speedOfSound from temperature', () => {
    const d = computeDerivedConfig(25, 4.0, 0.2);
    const expected = 331.3 * Math.sqrt(1 + 25 / 273.15) * (1 + 0.00006 * 50);
    expect(d.speedOfSound).toBeCloseTo(expected, 1);
  });

  // listenMs
  it('computes listenMs from maxRange (default 4m)', () => {
    const d = computeDerivedConfig(25, 4.0, 0.2);
    const c = 331.3 * Math.sqrt(1 + 25 / 273.15) * (1 + 0.00006 * 50);
    const expected = (2 * 4.0 / c) * 1000 + 50;
    expect(d.listenMs).toBeCloseTo(expected, 0);
  });
  it('scales listenMs with maxRange', () => {
    const d = computeDerivedConfig(25, 10.0, 0.2);
    const c = 331.3 * Math.sqrt(1 + 25 / 273.15) * (1 + 0.00006 * 50);
    const expected = (2 * 10 / c) * 1000 + 50;
    expect(d.listenMs).toBeCloseTo(expected, 0);
  });
  it('listenMs is 50ms when maxRange is 0', () => {
    const d = computeDerivedConfig(25, 0, 0.2);
    expect(d.listenMs).toBeCloseTo(50, 0);
  });
  it('lower temperature → higher listenMs (slower sound)', () => {
    const cold = computeDerivedConfig(18, 4.0, 0.2);
    const hot = computeDerivedConfig(42, 4.0, 0.2);
    expect(cold.listenMs).toBeGreaterThan(hot.listenMs);
  });

  // minRange
  it('computes minRange as spacing + 0.05', () => {
    const d = computeDerivedConfig(25, 4.0, 0.4);
    expect(d.minRange).toBe(0.45);
  });
  it('floors minRange at 0.3', () => {
    const d = computeDerivedConfig(25, 4.0, 0.1);
    expect(d.minRange).toBe(0.3);
  });
  it('handles minimum spacing (0.02)', () => {
    const d = computeDerivedConfig(25, 4.0, 0.02);
    expect(d.minRange).toBe(0.3);
  });

  // scanDwell
  it('scanDwell equals listenMs', () => {
    const d = computeDerivedConfig(25, 4.0, 0.2);
    expect(d.scanDwell).toBe(d.listenMs);
  });

  // negative maxRange clamped to 0
  it('clamps negative maxRange to 0 (listenMs = 50)', () => {
    const d = computeDerivedConfig(25, -5, 0.2);
    expect(d.listenMs).toBeCloseTo(50, 0);
    expect(d.scanDwell).toBeCloseTo(50, 0);
  });

  // negative spacing still floors minRange at 0.3
  it('floors minRange at 0.3 for negative spacing', () => {
    const d = computeDerivedConfig(25, 4.0, -0.1);
    expect(d.minRange).toBe(0.3);
  });

  // boundary temperatures (18-42°C range)
  it('valid at min temperature (18°C)', () => {
    const d = computeDerivedConfig(18, 4.0, 0.2);
    expect(d.speedOfSound).toBeGreaterThan(200);
    expect(d.speedOfSound).toBeLessThan(400);
    expect(d.listenMs).toBeGreaterThan(0);
    expect(d.minRange).toBeGreaterThanOrEqual(0.3);
  });
  it('valid at max temperature (42°C)', () => {
    const d = computeDerivedConfig(42, 4.0, 0.2);
    expect(d.speedOfSound).toBeGreaterThan(200);
    expect(d.speedOfSound).toBeLessThan(400);
    expect(d.listenMs).toBeGreaterThan(0);
    expect(d.minRange).toBeGreaterThanOrEqual(0.3);
  });

  // minGolayGapMs
  it('minGolayGapMs = ceil(2*4/346.45*1000)+2 = 26 for default config', () => {
    const d = computeDerivedConfig(25, 4.0, 0.2);
    // speedOfSound = 331.3 + 0.606 * 25 = 346.45
    // ceil(2 * 4 / 346.45 * 1000) + 2 = ceil(23.098) + 2 = 24 + 2 = 26
    expect(d.minGolayGapMs).toBe(26);
  });

  it('minGolayGapMs returns 2ms minimum when maxRange=0', () => {
    const d = computeDerivedConfig(25, 0, 0.2);
    // safeMaxRange = max(0, 0) = 0, ceil(0) + 2 = 2
    expect(d.minGolayGapMs).toBe(2);
  });

  it('minGolayGapMs scales with maxRange (10m > 4m)', () => {
    const d4 = computeDerivedConfig(25, 4.0, 0.2);
    const d10 = computeDerivedConfig(25, 10.0, 0.2);
    expect(d10.minGolayGapMs).toBeGreaterThan(d4.minGolayGapMs);
  });

  it('minGolayGapMs increases at lower temperatures', () => {
    // Lower temperature → slower speed of sound → longer round trip → larger gap
    const cold = computeDerivedConfig(18, 4.0, 0.2);
    const hot = computeDerivedConfig(42, 4.0, 0.2);
    expect(cold.minGolayGapMs).toBeGreaterThanOrEqual(hot.minGolayGapMs);
  });
});
