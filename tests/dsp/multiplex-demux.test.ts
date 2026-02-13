import { genMultiplex } from '../../src/signal/multiplex.js';
import { demuxMultiplexProfile } from '../../src/dsp/multiplex-demux.js';

describe('demuxMultiplexProfile', () => {
  it('builds fused profile for delayed synthetic capture', () => {
    const sampleRate = 48000;
    const c = 343;
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

    const delaySamples = 120;
    const capture = new Float32Array(mux.ref.length + delaySamples + 64);
    for (let i = 0; i < mux.ref.length; i++) {
      capture[delaySamples + i] += mux.ref[i];
      const weakIdx = delaySamples + 24 + i;
      if (weakIdx < capture.length) capture[weakIdx] += 0.25 * mux.ref[i];
    }

    const out = demuxMultiplexProfile({
      signal: capture,
      refsByCarrier: mux.refsByCarrier,
      carrierHz: mux.carrierHz,
      fusion: 'snrWeighted',
      trimFraction: 0.2,
      c,
      minR: 0.05,
      maxR: 1.2,
      sampleRate,
      heatBins: 128,
      predictedTau0: null,
      lockStrength: 0,
    });

    expect(out.profile.length).toBe(128);
    expect(out.corrReal.length).toBeGreaterThan(100);
    expect(out.tau0).toBeGreaterThan(0);
    expect(out.debug.stats.length).toBe(6);
    expect(out.debug.activeCarrierCount).toBeGreaterThan(0);

    let maxVal = 0;
    for (let i = 0; i < out.profile.length; i++) {
      if (out.profile[i] > maxVal) maxVal = out.profile[i];
    }
    expect(maxVal).toBeGreaterThan(1e-6);

    const delayTau = delaySamples / sampleRate;
    const estimatedRange = (delayTau * c) / 2;
    expect(estimatedRange).toBeGreaterThan(0.3);
  });
});
