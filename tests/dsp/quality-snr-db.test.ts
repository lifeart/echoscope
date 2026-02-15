import { computeProfileQualityStats } from '../../src/dsp/quality.js';

/**
 * Regression test: snrDb must use 20·log10 (amplitude-ratio dB) not
 * 10·log10 (power-ratio dB).
 *
 * For a profile where peak / floor = 100, the correct amplitude-dB
 * value is 20·log10(100) = 40 dB.  The bug produces 10·log10(100) = 20 dB,
 * exactly half.  This affects every quality-switching threshold downstream.
 */
describe('computeProfileQualityStats snrDb scale', () => {
  it('computes snrDb using amplitude dB (20·log10)', () => {
    // Create a profile where peak = 100, median (floor) = 1.
    // PSR = 100.  Correct snrDb = 20·log10(100) = 40 dB.
    const profile = new Float32Array(101);
    for (let i = 0; i < 101; i++) profile[i] = 1; // floor = median = 1
    profile[50] = 100; // peak = 100

    const stats = computeProfileQualityStats(profile);
    expect(stats.psr).toBeCloseTo(100, 1);

    // 20 * log10(100) = 40.0
    // BUG: code produces 10 * log10(100) = 20.0
    expect(stats.snrDb).toBeCloseTo(40, 0);
  });

  it('returns correct dB for small PSR', () => {
    // peak = 2, floor = 1  → PSR = 2 → 20·log10(2) ≈ 6.02 dB
    const profile = new Float32Array(51);
    for (let i = 0; i < 51; i++) profile[i] = 1;
    profile[25] = 2;

    const stats = computeProfileQualityStats(profile);
    expect(stats.psr).toBeCloseTo(2, 1);
    expect(stats.snrDb).toBeCloseTo(6.02, 0); // NOT 3.01
  });

  it('returns correct dB for PSR = 10', () => {
    // PSR = 10 → 20·log10(10) = 20 dB
    const profile = new Float32Array(51);
    for (let i = 0; i < 51; i++) profile[i] = 1;
    profile[25] = 10;

    const stats = computeProfileQualityStats(profile);
    expect(stats.snrDb).toBeCloseTo(20, 0); // NOT 10
  });
});
