import { describe, it, expect } from 'vitest';
import { speedOfSoundFromTemp, SPEED_OF_SOUND, LAPTOP_PRESET_SCAN } from '../../src/constants.js';

describe('speedOfSoundFromTemp', () => {
  it('returns correct value at 25°C (default)', () => {
    const expected = 331.3 * Math.sqrt(1 + 25 / 273.15) * (1 + 0.00006 * 50);
    expect(speedOfSoundFromTemp(25)).toBeCloseTo(expected, 1);
  });
  it('returns correct value at 18°C (min range)', () => {
    const expected = 331.3 * Math.sqrt(1 + 18 / 273.15) * (1 + 0.00006 * 50);
    expect(speedOfSoundFromTemp(18)).toBeCloseTo(expected, 1);
  });
  it('returns correct value at 42°C (max range)', () => {
    const expected = 331.3 * Math.sqrt(1 + 42 / 273.15) * (1 + 0.00006 * 50);
    expect(speedOfSoundFromTemp(42)).toBeCloseTo(expected, 1);
  });
  it('returns ~331.3 at 0°C (freezing)', () => {
    // At 0°C with default 50% humidity: 331.3 * 1.003 ≈ 331.3
    const expected = 331.3 * (1 + 0.00006 * 50);
    expect(speedOfSoundFromTemp(0)).toBeCloseTo(expected, 1);
  });
});

describe('SPEED_OF_SOUND constant', () => {
  it('equals speedOfSoundFromTemp(25)', () => {
    expect(SPEED_OF_SOUND).toBe(speedOfSoundFromTemp(25));
  });
});

describe('LAPTOP_PRESET_SCAN', () => {
  it('does not contain derived fields (listenMs, scanDwell)', () => {
    const keys = Object.keys(LAPTOP_PRESET_SCAN);
    expect(keys).not.toContain('listenMs');
    expect(keys).not.toContain('scanDwell');
  });
});
