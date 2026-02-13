import { shouldUseMultibandOverride } from '../../src/calibration/engine.js';

describe('shouldUseMultibandOverride', () => {
  it('returns false when no selected multiband result exists', () => {
    expect(shouldUseMultibandOverride({ valid: true, quality: 0.7 }, undefined)).toBe(false);
    expect(shouldUseMultibandOverride({ valid: true, quality: 0.7 }, null)).toBe(false);
  });

  it('returns false when selected multiband result is invalid', () => {
    expect(shouldUseMultibandOverride(
      { valid: false, quality: 0.3 },
      { valid: false, quality: 0.9 },
    )).toBe(false);
  });

  it('returns true when wideband is invalid and selected multiband is valid', () => {
    expect(shouldUseMultibandOverride(
      { valid: false, quality: 0.4 },
      { valid: true, quality: 0.2 },
    )).toBe(true);
  });

  it('requires higher quality when wideband is already valid', () => {
    expect(shouldUseMultibandOverride(
      { valid: true, quality: 0.7 },
      { valid: true, quality: 0.6 },
    )).toBe(false);

    expect(shouldUseMultibandOverride(
      { valid: true, quality: 0.7 },
      { valid: true, quality: 0.8 },
    )).toBe(true);
  });
});
