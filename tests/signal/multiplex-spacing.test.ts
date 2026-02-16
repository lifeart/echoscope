/**
 * Tests for Fix #9: Multiplex carrier spacing orthogonality.
 *
 * Verifies that genMultiplex places carriers with at least the
 * minimum orthogonal spacing (no 0.8× relaxation factor) to
 * prevent inter-carrier interference.
 */
import { describe, it, expect } from 'vitest';
import { genMultiplex } from '../../src/signal/multiplex.js';

describe('multiplex carrier orthogonal spacing', () => {
  it('all carriers are separated by at least the orthogonal spacing', () => {
    const out = genMultiplex({
      carrierCount: 6,
      fStart: 2200,
      fEnd: 8800,
      symbolMs: 8,
      guardHz: 180,
      minSpacingHz: 220,
      calibrationCandidates: 12,
      fusion: 'snrWeighted',
    }, 48000);

    const carriers = out.carrierHz.slice().sort((a, b) => a - b);
    const symbolDur = 8 / 1000;
    const minOrthSpacing = Math.max(1 / symbolDur, 180, 220);

    for (let i = 1; i < carriers.length; i++) {
      const spacing = carriers[i] - carriers[i - 1];
      // No carrier pair should be closer than the orthogonal minimum
      expect(spacing).toBeGreaterThanOrEqual(minOrthSpacing - 1); // 1 Hz tolerance
    }
  });

  it('orthogonal spacing is at least 1/T', () => {
    const symbolMs = 10; // 1/T = 100 Hz
    const out = genMultiplex({
      carrierCount: 4,
      fStart: 2000,
      fEnd: 6000,
      symbolMs,
      guardHz: 50,
      minSpacingHz: 50,
      calibrationCandidates: 8,
      fusion: 'snrWeighted',
    }, 48000);

    const carriers = out.carrierHz.slice().sort((a, b) => a - b);
    for (let i = 1; i < carriers.length; i++) {
      const spacing = carriers[i] - carriers[i - 1];
      expect(spacing).toBeGreaterThanOrEqual(1000 / symbolMs - 1);
    }
  });

  it('produces correct number of carriers and references', () => {
    const out = genMultiplex({
      carrierCount: 5,
      fStart: 2200,
      fEnd: 8800,
      symbolMs: 8,
      guardHz: 180,
      minSpacingHz: 220,
      calibrationCandidates: 12,
      fusion: 'snrWeighted',
    }, 48000);

    expect(out.carrierHz.length).toBe(5);
    expect(out.refsByCarrier.length).toBe(5);
  });
});
