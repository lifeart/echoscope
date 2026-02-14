import { clamp } from '../utils.js';
import { fftCorrelateComplex } from './fft-correlate.js';
import { findDirectPathTau } from '../calibration/direct-path.js';
import { buildRangeProfileFromCorrelation } from './profile.js';
import { estimateBestFromProfile } from './peak.js';
import type { MultiplexDebugInfo, MultiplexFusionMode, SubcarrierStat } from '../types.js';

interface CarrierFrame {
  corrReal: Float32Array;
  corrImag: Float32Array;
  profile: Float32Array;
  stat: SubcarrierStat;
  weight: number;
}

export interface MultiplexDemuxInput {
  signal: Float32Array;
  refsByCarrier: Float32Array[];
  carrierHz: number[];
  fusion: MultiplexFusionMode;
  trimFraction: number;
  c: number;
  minR: number;
  maxR: number;
  sampleRate: number;
  heatBins: number;
  predictedTau0: number | null;
  lockStrength: number;
  carrierWeights?: number[];
}

export interface MultiplexDemuxOutput {
  corrReal: Float32Array;
  corrImag: Float32Array;
  tau0: number;
  profile: Float32Array;
  debug: MultiplexDebugInfo;
}

function signalEnergy(a: Float32Array): number {
  let e = 0;
  for (let i = 0; i < a.length; i++) e += a[i] * a[i];
  return e;
}

function energyNormalize(corr: Float32Array, refEnergy: number): void {
  if (refEnergy <= 1e-12) return;
  const inv = 1 / refEnergy;
  for (let i = 0; i < corr.length; i++) corr[i] *= inv;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  if (values.length % 2 === 0) return 0.5 * (values[mid - 1] + values[mid]);
  return values[mid];
}

function fusedMedian(frames: CarrierFrame[], bins: number): Float32Array {
  const out = new Float32Array(bins);
  const values: number[] = new Array(frames.length);
  for (let b = 0; b < bins; b++) {
    for (let i = 0; i < frames.length; i++) values[i] = frames[i].profile[b] ?? 0;
    out[b] = median(values);
  }
  return out;
}

function fusedTrimmed(frames: CarrierFrame[], bins: number, trimFraction: number): Float32Array {
  const out = new Float32Array(bins);
  const values: number[] = new Array(frames.length);
  const trim = Math.min(Math.floor(frames.length * clamp(trimFraction, 0, 0.45)), Math.floor((frames.length - 1) / 2));
  for (let b = 0; b < bins; b++) {
    for (let i = 0; i < frames.length; i++) values[i] = frames[i].profile[b] ?? 0;
    values.sort((a, z) => a - z);
    const lo = trim;
    const hi = frames.length - trim;
    let sum = 0;
    for (let i = lo; i < hi; i++) sum += values[i];
    out[b] = sum / Math.max(1, hi - lo);
  }
  return out;
}

function profileStats(profile: Float32Array): { snrDb: number; psr: number; confidence: number } {
  const best = estimateBestFromProfile(profile, 0, 1);
  if (best.bin < 0 || best.val <= 0) return { snrDb: 0, psr: 0, confidence: 0 };

  const floorSamples: number[] = [];
  for (let i = 0; i < profile.length; i++) {
    if (Math.abs(i - best.bin) <= 2) continue;
    floorSamples.push(profile[i]);
  }
  const floor = Math.max(1e-12, median(floorSamples));
  const psr = best.val / floor;
  const snrDb = 10 * Math.log10(Math.max(1e-12, best.val) / floor);
  const normSnr = clamp((snrDb + 6) / 24, 0, 1);
  const normPsr = clamp((psr - 1.5) / 10, 0, 1);
  const confidence = clamp(0.6 * normSnr + 0.4 * normPsr, 0, 1);
  return { snrDb, psr, confidence };
}

function fuseWeighted(frames: CarrierFrame[], bins: number): Float32Array {
  const out = new Float32Array(bins);
  for (let b = 0; b < bins; b++) {
    let sum = 0;
    let wSum = 0;
    for (const frame of frames) {
      const w = Math.max(1e-6, frame.weight);
      sum += frame.profile[b] * w;
      wSum += w;
    }
    out[b] = sum / Math.max(1e-9, wSum);
  }
  return out;
}

export function demuxMultiplexProfile(input: MultiplexDemuxInput): MultiplexDemuxOutput {
  const count = Math.min(input.refsByCarrier.length, input.carrierHz.length);
  if (count <= 0) {
    return {
      corrReal: new Float32Array(0),
      corrImag: new Float32Array(0),
      tau0: 0,
      profile: new Float32Array(input.heatBins),
      debug: { activeCarrierCount: 0, usedCarrierHz: [], stats: [] },
    };
  }

  const corrRealBank: Float32Array[] = [];
  const corrImagBank: Float32Array[] = [];

  for (let i = 0; i < count; i++) {
    const ref = input.refsByCarrier[i];
    const corr = fftCorrelateComplex(input.signal, ref, input.sampleRate);
    const corrReal = corr.correlation;
    const corrImag = corr.correlationImag;
    const refEnergy = signalEnergy(ref);
    energyNormalize(corrReal, refEnergy);
    energyNormalize(corrImag, refEnergy);
    corrRealBank.push(corrReal);
    corrImagBank.push(corrImag);
  }

  const corrLen = corrRealBank[0]?.length ?? 0;
  const sumCorr = new Float32Array(corrLen);
  for (let i = 0; i < corrLen; i++) {
    let sum = 0;
    for (let c = 0; c < count; c++) sum += corrRealBank[c][i];
    sumCorr[i] = sum / count;
  }

  const tau0 = findDirectPathTau(sumCorr, input.predictedTau0, input.lockStrength, input.sampleRate);

  const frames: CarrierFrame[] = [];
  const stats: SubcarrierStat[] = [];
  for (let c = 0; c < count; c++) {
    const profile = buildRangeProfileFromCorrelation(
      corrRealBank[c],
      tau0,
      input.c,
      input.minR,
      input.maxR,
      input.sampleRate,
      input.heatBins,
      false,
    );
    const qual = profileStats(profile);
    const baseWeight = input.carrierWeights?.[c] ?? 1;
    const snrWeight = clamp((qual.snrDb + 8) / 24, 0.05, 1.0);
    const combinedWeight = baseWeight * (0.35 + 0.65 * qual.confidence) * snrWeight;

    const stat: SubcarrierStat = {
      frequencyHz: input.carrierHz[c],
      snrDb: qual.snrDb,
      psr: qual.psr,
      confidence: qual.confidence,
      weight: combinedWeight,
    };
    stats.push(stat);

    if (qual.confidence >= 0.12) {
      frames.push({
        corrReal: corrRealBank[c],
        corrImag: corrImagBank[c],
        profile,
        stat,
        weight: combinedWeight,
      });
    }
  }

  if (frames.length === 0) {
    const firstProfile = buildRangeProfileFromCorrelation(
      corrRealBank[0],
      tau0,
      input.c,
      input.minR,
      input.maxR,
      input.sampleRate,
      input.heatBins,
      false,
    );
    frames.push({
      corrReal: corrRealBank[0],
      corrImag: corrImagBank[0],
      profile: firstProfile,
      stat: stats[0],
      weight: Math.max(1e-6, stats[0]?.weight ?? 1),
    });
  }

  let fusedProfile: Float32Array;
  if (input.fusion === 'median') {
    fusedProfile = fusedMedian(frames, input.heatBins);
  } else if (input.fusion === 'trimmedMean') {
    fusedProfile = fusedTrimmed(frames, input.heatBins, input.trimFraction);
  } else {
    fusedProfile = fuseWeighted(frames, input.heatBins);
  }

  const fusedCorrReal = new Float32Array(corrLen);
  const fusedCorrImag = new Float32Array(corrLen);
  for (let i = 0; i < corrLen; i++) {
    let sumR = 0;
    let sumI = 0;
    let wSum = 0;
    for (const frame of frames) {
      const w = Math.max(1e-6, frame.weight);
      sumR += frame.corrReal[i] * w;
      sumI += frame.corrImag[i] * w;
      wSum += w;
    }
    fusedCorrReal[i] = sumR / Math.max(1e-9, wSum);
    fusedCorrImag[i] = sumI / Math.max(1e-9, wSum);
  }

  return {
    corrReal: fusedCorrReal,
    corrImag: fusedCorrImag,
    tau0,
    profile: fusedProfile,
    debug: {
      activeCarrierCount: frames.length,
      usedCarrierHz: frames.map(frame => frame.stat.frequencyHz),
      stats,
    },
  };
}
