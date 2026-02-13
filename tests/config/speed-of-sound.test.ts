import { describe, it, expect } from 'vitest';
import { speedOfSoundFromTemp, SPEED_OF_SOUND, LAPTOP_PRESET_SCAN } from '../../src/constants.js';

describe('speedOfSoundFromTemp', () => {
  it('returns ~346.45 at 25°C (default)', () => {
    expect(speedOfSoundFromTemp(25)).toBeCloseTo(346.45, 1);
  });
  it('returns ~342.21 at 18°C (min range)', () => {
    expect(speedOfSoundFromTemp(18)).toBeCloseTo(342.21, 1);
  });
  it('returns ~356.75 at 42°C (max range)', () => {
    expect(speedOfSoundFromTemp(42)).toBeCloseTo(356.75, 1);
  });
  it('returns 331.3 at 0°C (freezing)', () => {
    expect(speedOfSoundFromTemp(0)).toBeCloseTo(331.3, 1);
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
