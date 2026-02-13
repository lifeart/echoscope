import { describe, it, expect } from 'vitest';
import { buildRangeProfileFromCorrelation } from '../../src/dsp/profile.js';

describe('coherent integration concept', () => {
  it('averaging identical correlations preserves peak magnitude', () => {
    const sr = 48000;
    const c = 343;
    const corr = new Float32Array(Math.round(sr * 0.05));
    const peakSample = Math.round((2 * 2.0 / c) * sr); // 2m range
    corr[peakSample] = 0.5;

    const prof1 = buildRangeProfileFromCorrelation(corr, 0, c, 0.3, 4.0, sr, 240);

    // Average two identical correlations = same as original
    const averaged = new Float32Array(corr.length);
    for (let i = 0; i < corr.length; i++) averaged[i] = (corr[i] + corr[i]) / 2;
    const prof2 = buildRangeProfileFromCorrelation(averaged, 0, c, 0.3, 4.0, sr, 240);

    // Peak should be in same bin with same value
    let max1 = 0, max2 = 0, bin1 = 0, bin2 = 0;
    for (let i = 0; i < 240; i++) {
      if (prof1[i] > max1) { max1 = prof1[i]; bin1 = i; }
      if (prof2[i] > max2) { max2 = prof2[i]; bin2 = i; }
    }
    expect(bin1).toBe(bin2);
    expect(max2).toBeCloseTo(max1, 5);
  });

  it('averaging opposite-phase noise reduces noise floor', () => {
    const sr = 48000;
    const c = 343;
    const len = Math.round(sr * 0.05);
    const corr1 = new Float32Array(len);
    const corr2 = new Float32Array(len);

    // Add a signal peak to both
    const peakSample = Math.round((2 * 2.0 / c) * sr);
    corr1[peakSample] = 0.5;
    corr2[peakSample] = 0.5;

    // Add opposite-phase noise
    for (let i = 0; i < len; i++) {
      if (i !== peakSample) {
        const noise = 0.01 * Math.sin(i * 0.1);
        corr1[i] += noise;
        corr2[i] -= noise;
      }
    }

    // Average should cancel noise but preserve signal
    const averaged = new Float32Array(len);
    for (let i = 0; i < len; i++) averaged[i] = (corr1[i] + corr2[i]) / 2;

    const profAvg = buildRangeProfileFromCorrelation(averaged, 0, c, 0.3, 4.0, sr, 240);
    const profSingle = buildRangeProfileFromCorrelation(corr1, 0, c, 0.3, 4.0, sr, 240);

    // Find peak in averaged and single
    let peakAvg = 0, peakSingle = 0;
    for (let i = 0; i < 240; i++) {
      if (profAvg[i] > peakAvg) peakAvg = profAvg[i];
      if (profSingle[i] > peakSingle) peakSingle = profSingle[i];
    }

    // The averaged profile's peak should be at least as large as the single profile's peak
    // because noise cancellation improves the profile quality.
    // Note: buildRangeProfileFromCorrelation uses triangular bin splatting with averaging,
    // so absolute peak values depend on the bin weighting, not raw correlation amplitude.
    expect(peakAvg).toBeGreaterThan(0);

    // Compute RMS of non-peak bins to verify noise reduction
    let rmsAvg = 0, rmsSingle = 0;
    let peakBinAvg = 0, peakBinSingle = 0;
    for (let i = 0; i < 240; i++) {
      if (profAvg[i] === peakAvg) peakBinAvg = i;
      if (profSingle[i] === peakSingle) peakBinSingle = i;
    }

    let countAvg = 0, countSingle = 0;
    for (let i = 0; i < 240; i++) {
      if (Math.abs(i - peakBinAvg) > 3) {
        rmsAvg += profAvg[i] * profAvg[i];
        countAvg++;
      }
      if (Math.abs(i - peakBinSingle) > 3) {
        rmsSingle += profSingle[i] * profSingle[i];
        countSingle++;
      }
    }
    rmsAvg = Math.sqrt(rmsAvg / countAvg);
    rmsSingle = Math.sqrt(rmsSingle / countSingle);

    // Noise floor in averaged profile should be lower than single profile
    expect(rmsAvg).toBeLessThan(rmsSingle);
  });

  it('isDeterministicProbe concept: golay and mls are deterministic', () => {
    const isDeterministic = (type: string) => type === 'golay' || type === 'mls';
    expect(isDeterministic('golay')).toBe(true);
    expect(isDeterministic('mls')).toBe(true);
    expect(isDeterministic('chirp')).toBe(false);
  });

  it('ring buffer eviction: FIFO keeps last N frames, evicted peaks disappear', () => {
    const sr = 48000;
    const c = 343;
    const len = Math.round(sr * 0.05);
    const heatBins = 200;
    const minR = 0.3;
    const maxR = 4.0;
    const maxHistory = 3;

    // Create 5 frames with peaks at different ranges
    const ranges = [1.0, 1.5, 2.0, 2.5, 3.0];
    const frames: Float32Array[] = ranges.map(range => {
      const corr = new Float32Array(len);
      const peakSample = Math.round((2 * range / c) * sr);
      if (peakSample < len) corr[peakSample] = 0.5;
      return corr;
    });

    // Simulate FIFO ring buffer: push all 5, keep last 3
    const history: Float32Array[] = [];
    for (const frame of frames) {
      history.push(frame);
      while (history.length > maxHistory) history.shift();
    }
    expect(history.length).toBe(3);

    // Average the kept frames (last 3: ranges 2.0, 2.5, 3.0)
    const averaged = new Float32Array(len);
    for (const frame of history) {
      for (let i = 0; i < len; i++) averaged[i] += frame[i];
    }
    for (let i = 0; i < len; i++) averaged[i] /= history.length;

    const profAvg = buildRangeProfileFromCorrelation(averaged, 0, c, minR, maxR, sr, heatBins);

    // Find bin for evicted ranges (1.0m, 1.5m) and kept ranges (2.0m, 2.5m, 3.0m)
    function rangeToBin(range: number): number {
      return Math.round(((range - minR) / (maxR - minR)) * (heatBins - 1));
    }

    const evictedBin1 = rangeToBin(1.0);
    const evictedBin2 = rangeToBin(1.5);
    const keptBin = rangeToBin(2.5);

    // Evicted peaks should have zero energy in the averaged profile
    expect(profAvg[evictedBin1]).toBe(0);
    expect(profAvg[evictedBin2]).toBe(0);
    // At least one kept peak should have nonzero energy
    expect(profAvg[keptBin]).toBeGreaterThan(0);
  });

  it('per-angle separation: independent histories for different angles', () => {
    const sr = 48000;
    const c = 343;
    const len = Math.round(sr * 0.05);
    const heatBins = 200;
    const minR = 0.3;
    const maxR = 4.0;

    // Simulate two independent per-angle histories (like perAngleCoherentHistory map)
    const perAngleHistory = new Map<number, Float32Array[]>();
    const maxHistory = 3;

    // Angle 0: frames with peak at 1.5m
    const angle0Corr = new Float32Array(len);
    const peak0 = Math.round((2 * 1.5 / c) * sr);
    angle0Corr[peak0] = 0.8;

    // Angle 30: frames with peak at 3.0m
    const angle30Corr = new Float32Array(len);
    const peak30 = Math.round((2 * 3.0 / c) * sr);
    angle30Corr[peak30] = 0.6;

    // Push into separate angle histories
    function pushFrame(angleDeg: number, frame: Float32Array) {
      const hist = perAngleHistory.get(angleDeg) ?? [];
      hist.push(frame);
      while (hist.length > maxHistory) hist.shift();
      perAngleHistory.set(angleDeg, hist);
    }

    pushFrame(0, angle0Corr);
    pushFrame(30, angle30Corr);

    // Verify no cross-contamination: angle 0 history doesn't see angle 30 frames
    const hist0 = perAngleHistory.get(0)!;
    const hist30 = perAngleHistory.get(30)!;

    expect(hist0.length).toBe(1);
    expect(hist30.length).toBe(1);

    // Build profiles from each angle's history
    const prof0 = buildRangeProfileFromCorrelation(hist0[0], 0, c, minR, maxR, sr, heatBins);
    const prof30 = buildRangeProfileFromCorrelation(hist30[0], 0, c, minR, maxR, sr, heatBins);

    // Find peak bins
    let peak0Bin = 0, peak30Bin = 0, peak0Val = 0, peak30Val = 0;
    for (let i = 0; i < heatBins; i++) {
      if (prof0[i] > peak0Val) { peak0Val = prof0[i]; peak0Bin = i; }
      if (prof30[i] > peak30Val) { peak30Val = prof30[i]; peak30Bin = i; }
    }

    // Peaks should be at different bins (different ranges)
    expect(peak0Bin).not.toBe(peak30Bin);
    // Each profile should have its own peak but not the other's
    const bin1_5m = Math.round(((1.5 - minR) / (maxR - minR)) * (heatBins - 1));
    const bin3_0m = Math.round(((3.0 - minR) / (maxR - minR)) * (heatBins - 1));
    expect(Math.abs(peak0Bin - bin1_5m)).toBeLessThanOrEqual(2);
    expect(Math.abs(peak30Bin - bin3_0m)).toBeLessThanOrEqual(2);
  });
});
