import { genMultiplex } from '../../src/signal/multiplex.js';

describe('genMultiplex', () => {
  it('generates composite waveform and per-carrier references', () => {
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

    expect(out.ref.length).toBeGreaterThan(100);
    expect(out.refsByCarrier.length).toBe(6);
    expect(out.carrierHz.length).toBe(6);

    let absMax = 0;
    for (let i = 0; i < out.ref.length; i++) {
      const v = Math.abs(out.ref[i]);
      if (v > absMax) absMax = v;
    }
    expect(absMax).toBeGreaterThan(0.1);
    expect(absMax).toBeLessThanOrEqual(1.0);
  });

  it('respects calibrated active carriers when provided', () => {
    const out = genMultiplex({
      carrierCount: 4,
      fStart: 2000,
      fEnd: 9000,
      symbolMs: 8,
      guardHz: 150,
      minSpacingHz: 150,
      calibrationCandidates: 8,
      fusion: 'snrWeighted',
      activeCarrierHz: [2400, 3600, 5200, 7600],
      carrierWeights: [1, 2, 1, 1],
    }, 48000);

    expect(out.carrierHz.length).toBe(4);
    expect(Math.min(...out.carrierHz)).toBeGreaterThan(2000 - 200);
    expect(Math.max(...out.carrierHz)).toBeLessThan(9000 + 200);
  });

  it('fills missing carriers when calibrated list is partial', () => {
    const out = genMultiplex({
      carrierCount: 5,
      fStart: 2200,
      fEnd: 8800,
      symbolMs: 8,
      guardHz: 180,
      minSpacingHz: 220,
      calibrationCandidates: 12,
      fusion: 'snrWeighted',
      activeCarrierHz: [2600, 5200],
    }, 48000);

    expect(out.carrierHz.length).toBe(5);
    expect(out.carrierHz.some(v => Math.abs(v - 2600) < 120)).toBe(true);
    expect(out.carrierHz.some(v => Math.abs(v - 5200) < 120)).toBe(true);
  });
});
