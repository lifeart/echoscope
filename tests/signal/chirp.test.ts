import { genChirp } from '../../src/signal/chirp.js';

describe('genChirp', () => {
  it('generates correct length', () => {
    const sr = 48000;
    const result = genChirp({ f1: 2000, f2: 9000, durationMs: 10 }, sr);
    expect(result.length).toBe(Math.floor(sr * 0.01));
  });

  it('output is windowed (starts and ends near zero)', () => {
    const result = genChirp({ f1: 2000, f2: 9000, durationMs: 10 }, 48000);
    expect(Math.abs(result[0])).toBeLessThan(0.01);
    expect(Math.abs(result[result.length - 1])).toBeLessThan(0.01);
  });

  it('clamps frequencies', () => {
    // Very low f1 should be clamped to MIN_FREQUENCY
    const result = genChirp({ f1: 100, f2: 200, durationMs: 10 }, 48000);
    expect(result.length).toBeGreaterThan(0);
  });
});
