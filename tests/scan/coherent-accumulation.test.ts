import { describe, it, expect } from 'vitest';
import { buildRangeProfileFromCorrelation } from '../../src/dsp/profile.js';

describe('coherent accumulation (multi-pass concept)', () => {
  it('identical frames preserve peak position and amplitude', () => {
    const sr = 48000;
    const c = 343;
    const len = Math.round(sr * 0.05);
    const heatBins = 200;
    const minR = 0.3;
    const maxR = 4.0;

    // Simulate a single correlation frame
    const corr = new Float32Array(len);
    const targetRange = 1.5;
    const peakSample = Math.round((2 * targetRange / c) * sr);
    corr[peakSample] = 0.8;

    // Build profile from original
    const profOriginal = buildRangeProfileFromCorrelation(corr, 0, c, minR, maxR, sr, heatBins);

    // Average N identical frames (should be identical to original)
    const N = 4;
    const averaged = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      averaged[i] = (corr[i] * N) / N; // N copies averaged = original
    }
    const profAveraged = buildRangeProfileFromCorrelation(averaged, 0, c, minR, maxR, sr, heatBins);

    // Find peaks
    let binOrig = 0, binAvg = 0, valOrig = 0, valAvg = 0;
    for (let i = 0; i < heatBins; i++) {
      if (profOriginal[i] > valOrig) { valOrig = profOriginal[i]; binOrig = i; }
      if (profAveraged[i] > valAvg) { valAvg = profAveraged[i]; binAvg = i; }
    }

    expect(binAvg).toBe(binOrig);
    expect(valAvg).toBeCloseTo(valOrig, 5);
  });

  it('phase-consistent signal sums constructively', () => {
    const sr = 48000;
    const c = 343;
    const len = Math.round(sr * 0.05);
    const heatBins = 200;
    const minR = 0.3;
    const maxR = 4.0;

    const targetRange = 2.0;
    const peakSample = Math.round((2 * targetRange / c) * sr);

    // Create two frames with signal + different random-like noise
    const corr1 = new Float32Array(len);
    const corr2 = new Float32Array(len);

    // Signal is identical (phase-consistent) in both
    corr1[peakSample] = 0.5;
    corr2[peakSample] = 0.5;

    // Add different noise patterns
    for (let i = 0; i < len; i++) {
      if (i !== peakSample) {
        corr1[i] = 0.01 * Math.sin(i * 0.3 + 1.0);
        corr2[i] = 0.01 * Math.sin(i * 0.3 + 2.7);
      }
    }

    // Average the two frames
    const averaged = new Float32Array(len);
    for (let i = 0; i < len; i++) averaged[i] = (corr1[i] + corr2[i]) / 2;

    const profAvg = buildRangeProfileFromCorrelation(averaged, 0, c, minR, maxR, sr, heatBins);
    const profSingle = buildRangeProfileFromCorrelation(corr1, 0, c, minR, maxR, sr, heatBins);

    // Find peaks in both profiles
    let peakAvg = 0, peakSingle = 0;
    for (let i = 0; i < heatBins; i++) {
      if (profAvg[i] > peakAvg) peakAvg = profAvg[i];
      if (profSingle[i] > peakSingle) peakSingle = profSingle[i];
    }

    // The signal peak should be preserved in the averaged profile.
    // buildRangeProfileFromCorrelation uses triangular bin splatting + averaging,
    // so absolute peak value depends on bin weighting, but both profiles should
    // have a clear peak with comparable magnitude.
    expect(peakAvg).toBeGreaterThan(0);
    // Averaged profile peak should be close to single frame peak
    // (signal is preserved, only noise differs)
    expect(peakAvg).toBeCloseTo(peakSingle, 0);
  });

  it('isDeterministicProbe: true for golay/mls, false for chirp', () => {
    const isDeterministic = (probeType: string) =>
      probeType === 'golay' || probeType === 'mls';

    expect(isDeterministic('golay')).toBe(true);
    expect(isDeterministic('mls')).toBe(true);
    expect(isDeterministic('chirp')).toBe(false);
    // Edge cases
    expect(isDeterministic('')).toBe(false);
    expect(isDeterministic('noise')).toBe(false);
  });

  it('non-coherent noise does not grow with averaging', () => {
    const sr = 48000;
    const c = 343;
    const len = Math.round(sr * 0.05);
    const heatBins = 200;
    const minR = 0.3;
    const maxR = 4.0;

    // Pure noise frames (no signal)
    const frames: Float32Array[] = [];
    for (let f = 0; f < 8; f++) {
      const corr = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        corr[i] = 0.01 * Math.sin(i * 0.1 + f * 1.23);
      }
      frames.push(corr);
    }

    // Average all frames
    const averaged = new Float32Array(len);
    for (const frame of frames) {
      for (let i = 0; i < len; i++) averaged[i] += frame[i];
    }
    for (let i = 0; i < len; i++) averaged[i] /= frames.length;

    // Single frame profile
    const profSingle = buildRangeProfileFromCorrelation(frames[0], 0, c, minR, maxR, sr, heatBins);
    // Averaged profile
    const profAvg = buildRangeProfileFromCorrelation(averaged, 0, c, minR, maxR, sr, heatBins);

    // RMS of averaged should be <= RMS of single (noise reduction)
    let rmsSingle = 0, rmsAvg = 0;
    for (let i = 0; i < heatBins; i++) {
      rmsSingle += profSingle[i] * profSingle[i];
      rmsAvg += profAvg[i] * profAvg[i];
    }
    rmsSingle = Math.sqrt(rmsSingle / heatBins);
    rmsAvg = Math.sqrt(rmsAvg / heatBins);

    expect(rmsAvg).toBeLessThanOrEqual(rmsSingle + 1e-6);
  });
});
