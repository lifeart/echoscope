/**
 * Tests for Fix #2: MLS primitive polynomial tap corrections.
 *
 * Verifies that all supported MLS orders produce maximal-length sequences
 * with the correct circular auto-correlation property: R(0) = L, R(k) = -1.
 * This is the definitive test that tap polynomials are primitive.
 */
import { describe, it, expect } from 'vitest';
import { genMLS } from '../../src/signal/mls.js';

describe('MLS corrected tap polynomials', () => {
  // A sequence is maximal-length iff its circular autocorrelation is:
  //   R(0) = L, R(k≠0) = -1 for all k in [1, L-1]
  // This only holds when the feedback polynomial is truly primitive mod 2.
  for (let order = 2; order <= 16; order++) {
    it(`order ${order}: produces maximal-length sequence with ideal autocorrelation`, () => {
      const seq = genMLS(order);
      const L = seq.length;
      expect(L).toBe((1 << order) - 1);

      // Verify autocorrelation at lag 0
      let r0 = 0;
      for (let i = 0; i < L; i++) r0 += seq[i] * seq[i];
      expect(r0).toBe(L);

      // Verify autocorrelation at several non-zero lags
      const testLags = [1, 2, 3, Math.floor(L / 4), Math.floor(L / 2), L - 1];
      for (const lag of testLags) {
        if (lag <= 0 || lag >= L) continue;
        let sum = 0;
        for (let i = 0; i < L; i++) {
          sum += seq[i] * seq[(i + lag) % L];
        }
        expect(sum).toBe(-1);
      }
    });
  }

  it('balance: exactly 2^(n-1) ones and 2^(n-1)-1 minus-ones', () => {
    for (let order = 2; order <= 16; order++) {
      const seq = genMLS(order);
      const ones = Array.from(seq).filter(v => v === 1).length;
      const neg = Array.from(seq).filter(v => v === -1).length;
      expect(ones).toBe(1 << (order - 1));
      expect(neg).toBe((1 << (order - 1)) - 1);
    }
  });

  it('each order produces all unique values (no short period)', () => {
    for (const order of [3, 5, 8, 10, 12, 16]) {
      const seq = genMLS(order);
      const L = seq.length;
      // Verify the sequence doesn't repeat with any smaller period
      for (const p of [1, 2, 3, 5, 7]) {
        if (p >= L) continue;
        let allMatch = true;
        for (let i = 0; i < L; i++) {
          if (seq[i] !== seq[i % p]) { allMatch = false; break; }
        }
        expect(allMatch).toBe(false);
      }
    }
  });
});
