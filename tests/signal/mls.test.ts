import { genMLS, genMLSChipped } from '../../src/signal/mls.js';

describe('genMLS', () => {
  it('generates correct length', () => {
    const seq = genMLS(8);
    expect(seq.length).toBe((1 << 8) - 1); // 255
  });

  it('contains only +1 and -1', () => {
    const seq = genMLS(6);
    for (let i = 0; i < seq.length; i++) {
      expect(Math.abs(seq[i])).toBe(1);
    }
  });

  it('throws for invalid order', () => {
    expect(() => genMLS(1)).toThrow();
    expect(() => genMLS(17)).toThrow();
  });
});

describe('genMLSChipped', () => {
  it('generates audio samples', () => {
    const result = genMLSChipped({ order: 8, chipRate: 4000 }, 48000);
    expect(result.length).toBeGreaterThan(0);
    // Length should be seq.length * chipSamples
    const chipSamples = Math.floor(48000 / 4000);
    expect(result.length).toBe(255 * chipSamples);
  });
});
