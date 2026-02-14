import { designBandpass, applyBandpass, type BandpassCoeffs } from '../dsp/bandpass.js';
import { fftCorrelateComplex } from '../dsp/fft-correlate.js';
import { buildRangeProfileFromCorrelation } from '../dsp/profile.js';
import { clamp, signalEnergy, energyNormalize } from '../utils.js';

export interface ChirpSubbandStabilityMetrics {
  bandCount: number;
  supportCount: number;
  tauSpreadBins: number;
  stability: number;
  confidenceBoost: number;
}

interface ChirpSubbandInput {
  micSignal: Float32Array;
  ref: Float32Array;
  tau0: number;
  c: number;
  minR: number;
  maxR: number;
  sampleRate: number;
  heatBins: number;
  bestBin: number;
  f1: number;
  f2: number;
}

const coeffCache = new Map<string, BandpassCoeffs>();
const COEFF_CACHE_MAX = 32;

function getCachedBandpass(sampleRate: number, fLow: number, fHigh: number, taps = 129): BandpassCoeffs {
  const key = `${sampleRate}:${fLow.toFixed(1)}:${fHigh.toFixed(1)}:${taps}`;
  const cached = coeffCache.get(key);
  if (cached) return cached;
  // Evict oldest entries when cache exceeds limit
  if (coeffCache.size >= COEFF_CACHE_MAX) {
    const firstKey = coeffCache.keys().next().value;
    if (firstKey !== undefined) coeffCache.delete(firstKey);
  }
  const coeffs = designBandpass(fLow, fHigh, sampleRate, taps);
  coeffCache.set(key, coeffs);
  return coeffs;
}

function findLocalPeak(profile: Float32Array, centerBin: number, windowBins: number): { bin: number; value: number; bandMax: number } {
  if (profile.length === 0) return { bin: -1, value: 0, bandMax: 0 };

  let bandMax = 0;
  for (let i = 0; i < profile.length; i++) {
    if (profile[i] > bandMax) bandMax = profile[i];
  }

  const start = Math.max(0, centerBin - windowBins);
  const end = Math.min(profile.length - 1, centerBin + windowBins);
  let bestBin = -1;
  let bestVal = 0;
  for (let i = start; i <= end; i++) {
    const v = profile[i];
    if (v > bestVal) {
      bestVal = v;
      bestBin = i;
    }
  }

  return { bin: bestBin, value: bestVal, bandMax };
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  let varSum = 0;
  for (const v of values) {
    const d = v - mean;
    varSum += d * d;
  }
  return Math.sqrt(varSum / values.length);
}

export function computeChirpSubbandStability(input: ChirpSubbandInput): ChirpSubbandStabilityMetrics | null {
  if (input.bestBin < 0 || input.heatBins <= 0) return null;
  if (!(Number.isFinite(input.f1) && Number.isFinite(input.f2))) return null;

  const nyquist = input.sampleRate * 0.5;
  const fLo = clamp(Math.min(input.f1, input.f2), 300, nyquist * 0.90);
  const fHi = clamp(Math.max(input.f1, input.f2), fLo + 600, nyquist * 0.95);
  const bandwidth = fHi - fLo;
  if (bandwidth < 1200) return null;

  const e0 = fLo;
  const e1 = fLo + bandwidth / 3;
  const e2 = fLo + (2 * bandwidth) / 3;
  const e3 = fHi;
  const bands: Array<[number, number]> = [[e0, e1], [e1, e2], [e2, e3]];

  const windowBins = Math.max(4, Math.floor(input.heatBins * 0.05));
  const acceptedBins: number[] = [];
  const acceptedVals: number[] = [];

  for (const [bLo, bHi] of bands) {
    const coeffs = getCachedBandpass(input.sampleRate, bLo, bHi, 129);
    const micBand = applyBandpass(input.micSignal, coeffs);
    const refBand = applyBandpass(input.ref, coeffs);
    const bandRefEnergy = signalEnergy(refBand);
    if (bandRefEnergy <= 1e-12) continue;
    const corr = fftCorrelateComplex(micBand, refBand, input.sampleRate).correlation;
    energyNormalize(corr, bandRefEnergy);

    // The 129-tap FIR bandpass has a group delay of 64 samples.
    // Cross-correlation of two identically-filtered signals preserves the
    // peak location (group delay cancels), but edge effects on short signals
    // can shift the envelope slightly. Use the wideband tau0 directly since
    // the LTI filtering does not displace the true peak.
    const profileBand = buildRangeProfileFromCorrelation(
      corr,
      input.tau0,
      input.c,
      input.minR,
      input.maxR,
      input.sampleRate,
      input.heatBins,
      false,
    );

    const local = findLocalPeak(profileBand, input.bestBin, windowBins);
    if (local.bin < 0 || local.value <= 0 || local.bandMax <= 1e-12) continue;

    const supportRatio = local.value / local.bandMax;
    if (supportRatio >= 0.55) {
      acceptedBins.push(local.bin);
      acceptedVals.push(local.value);
    }
  }

  const bandCount = bands.length;
  const supportCount = acceptedBins.length;
  if (supportCount < 2) {
    return {
      bandCount,
      supportCount,
      tauSpreadBins: Number.POSITIVE_INFINITY,
      stability: 0,
      confidenceBoost: 0,
    };
  }

  const tauSpreadBins = stdDev(acceptedBins);
  const spreadNorm = clamp(tauSpreadBins / 8, 0, 1);
  const supportNorm = clamp((supportCount - 1) / (bandCount - 1), 0, 1);
  const stability = clamp((1 - spreadNorm) * supportNorm, 0, 1);

  let valSum = 0;
  for (const v of acceptedVals) valSum += v;
  const valMean = valSum / Math.max(1, acceptedVals.length);
  const valueMargin = clamp(valMean / Math.max(1e-12, Math.max(...acceptedVals)), 0, 1);

  const confidenceBoost = supportCount >= 2
    ? clamp(0.065 * stability + 0.02 * valueMargin, 0, 0.08)
    : 0;

  return {
    bandCount,
    supportCount,
    tauSpreadBins,
    stability,
    confidenceBoost,
  };
}
