import { genMultiplex } from '../../src/signal/multiplex.js';
import { demuxMultiplexProfile } from '../../src/dsp/multiplex-demux.js';

describe('demuxMultiplexProfile', () => {
  it('builds fused profile and carrier stats for clean synthetic signal', () => {
    const sampleRate = 48000;
    const mux = genMultiplex({
      carrierCount: 6,
      fStart: 2200,
      fEnd: 8800,
      symbolMs: 8,
      guardHz: 180,
      minSpacingHz: 220,
      calibrationCandidates: 12,
      fusion: 'snrWeighted',
    }, sampleRate);

    const out = demuxMultiplexProfile({
      signal: mux.ref,
      refsByCarrier: mux.refsByCarrier,
      carrierHz: mux.carrierHz,
      fusion: 'snrWeighted',
      trimFraction: 0.2,
      c: 343,
      minR: 0.3,
      maxR: 4.0,
      sampleRate,
      heatBins: 240,
      predictedTau0: null,
      lockStrength: 0,
    });

    expect(out.profile.length).toBe(240);
    expect(out.corrReal.length).toBeGreaterThan(0);
    expect(out.debug.stats.length).toBe(6);
    expect(out.debug.activeCarrierCount).toBeGreaterThan(0);
  });
});
