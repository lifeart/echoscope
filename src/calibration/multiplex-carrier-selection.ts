import { clamp, mad, median, sleep } from '../utils.js';
import { hann } from '../signal/window.js';
import { fftCorrelateComplex } from '../dsp/fft-correlate.js';
import { findDirectPathTau } from './direct-path.js';
import { buildRangeProfileFromCorrelation } from '../dsp/profile.js';
import { estimateBestFromProfile } from '../dsp/peak.js';
import { computeProfileConfidence } from '../scan/confidence.js';
import { pingAndCaptureSteered } from '../spatial/steering.js';
import { MAX_FREQUENCY, MIN_FREQUENCY } from '../constants.js';
import type { CarrierCalibrationCandidate, CarrierCalibrationResult, MultiplexConfig } from '../types.js';

interface QualificationInput {
  config: MultiplexConfig;
  sampleRate: number;
  c: number;
  minR: number;
  maxR: number;
  heatBins: number;
  gain: number;
  listenMs: number;
  strengthGate: number;
  confidenceGate: number;
  repeats?: number;
  gapMs?: number;
}

interface CandidateScore {
  frequencyHz: number;
  snrDb: number;
  psr: number;
  stability: number;
  detectRate: number;
  score: number;
}

function toneRef(freqHz: number, symbolMs: number, sampleRate: number): Float32Array {
  const n = Math.max(32, Math.floor(sampleRate * (Math.max(2, symbolMs) / 1000)));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    out[i] = Math.sin(2 * Math.PI * freqHz * t) * hann(i, n);
  }

  let mx = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(out[i]);
    if (v > mx) mx = v;
  }
  if (mx > 1e-12) {
    const scale = 0.98 / mx;
    for (let i = 0; i < n; i++) out[i] *= scale;
  }
  return out;
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

export function buildCandidateGrid(config: MultiplexConfig, sampleRate: number): number[] {
  const count = Math.max(4, Math.floor(config.calibrationCandidates));
  const nyquistSafe = Math.min(MAX_FREQUENCY, 0.45 * sampleRate);
  const lo = clamp(Math.min(config.fStart, config.fEnd), MIN_FREQUENCY, nyquistSafe);
  const hi = clamp(Math.max(config.fStart, config.fEnd), MIN_FREQUENCY, nyquistSafe);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo + 1e-9) return [lo];
  if (count <= 1) return [0.5 * (lo + hi)];
  const span = Math.max(0, hi - lo);
  const step = span / Math.max(1, count - 1);
  const frequencies: number[] = [];
  for (let i = 0; i < count; i++) {
    frequencies.push(lo + i * step);
  }
  return frequencies;
}

function floorMedian(profile: Float32Array, bestBin: number): number {
  const values: number[] = [];
  for (let i = 0; i < profile.length; i++) {
    if (Math.abs(i - bestBin) <= 2) continue;
    values.push(profile[i]);
  }
  return Math.max(1e-12, median(values));
}

function scoreCarrier(
  frequencyHz: number,
  snrDbValues: number[],
  psrValues: number[],
  rangeValues: number[],
  detectionFlags: boolean[],
): CandidateScore {
  const snrDb = snrDbValues.length ? median(snrDbValues) : -60;
  const psr = psrValues.length ? median(psrValues) : 0;

  const rangeMedian = rangeValues.length ? median(rangeValues) : 0;
  const rangeMad = rangeValues.length > 1 ? mad(rangeValues, rangeMedian) : 0;
  const stability = clamp(1 - rangeMad / 0.08, 0, 1);

  const detectRate = detectionFlags.length
    ? detectionFlags.filter(Boolean).length / detectionFlags.length
    : 0;

  const snrN = clamp((snrDb + 8) / 28, 0, 1);
  const psrN = clamp((psr - 1.4) / 10, 0, 1);
  const stabilityN = stability;
  const detectRateN = detectRate;
  const score = 0.40 * snrN + 0.30 * psrN + 0.20 * stabilityN + 0.10 * detectRateN;

  return { frequencyHz, snrDb, psr, stability, detectRate, score };
}

export function selectBestCarrierSubset(
  scored: CandidateScore[],
  selectedCount: number,
  minSpacingHz: number,
): CarrierCalibrationResult {
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const candidates: CarrierCalibrationCandidate[] = [];
  const selected: CandidateScore[] = [];

  for (const item of sorted) {
    let rejectionReason: CarrierCalibrationCandidate['rejectionReason'] | undefined;
    if (item.snrDb < -2) rejectionReason = 'snr';
    else if (item.psr < 1.2) rejectionReason = 'psr';
    else if (item.stability < 0.2) rejectionReason = 'stability';
    else {
      for (const chosen of selected) {
        if (Math.abs(chosen.frequencyHz - item.frequencyHz) < minSpacingHz) {
          rejectionReason = 'spacing';
          break;
        }
      }
    }

    const canSelect = !rejectionReason && selected.length < selectedCount;
    if (canSelect) selected.push(item);

    candidates.push({
      frequencyHz: item.frequencyHz,
      snrDb: item.snrDb,
      psr: item.psr,
      stability: item.stability,
      detectRate: item.detectRate,
      score: item.score,
      selected: canSelect,
      rejectionReason: canSelect ? undefined : rejectionReason ?? 'floor',
    });
  }

  if (selected.length === 0 && sorted.length > 0) {
    selected.push(sorted[0]);
    const idx = candidates.findIndex(c => c.frequencyHz === sorted[0].frequencyHz);
    if (idx >= 0) {
      candidates[idx].selected = true;
      candidates[idx].rejectionReason = undefined;
    }
  }

  const selectedByHz = [...selected].sort((a, b) => a.frequencyHz - b.frequencyHz);
  const rawWeights = selectedByHz.map(c => Math.max(1e-3, c.score));
  const sumWeights = rawWeights.reduce((acc, value) => acc + value, 0);
  const carrierWeights = rawWeights.map(value => value / Math.max(1e-9, sumWeights));

  return {
    activeCarrierHz: selectedByHz.map(c => c.frequencyHz),
    carrierWeights,
    minSpacingHz,
    candidates,
    computedAtMs: Date.now(),
  };
}

export async function qualifyMultiplexCarriers(input: QualificationInput): Promise<CarrierCalibrationResult> {
  const repeats = Math.max(2, Math.min(6, Math.floor(input.repeats ?? 3)));
  const gapMs = Math.max(5, input.gapMs ?? 14);
  const freqCandidates = buildCandidateGrid(input.config, input.sampleRate);

  const scored: CandidateScore[] = [];
  for (const freqHz of freqCandidates) {
    const ref = toneRef(freqHz, input.config.symbolMs, input.sampleRate);
    const refEnergy = signalEnergy(ref);

    const snrDbValues: number[] = [];
    const psrValues: number[] = [];
    const rangeValues: number[] = [];
    const detectionFlags: boolean[] = [];

    for (let i = 0; i < repeats; i++) {
      const capture = await pingAndCaptureSteered(ref, 0, input.gain, input.listenMs);
      const corr = fftCorrelateComplex(capture.micWin, ref, input.sampleRate).correlation;
      energyNormalize(corr, refEnergy);

      const tau0 = findDirectPathTau(corr, null, 0, input.sampleRate);
      const profile = buildRangeProfileFromCorrelation(
        corr,
        tau0,
        input.c,
        input.minR,
        input.maxR,
        input.sampleRate,
        input.heatBins,
      );
      const best = estimateBestFromProfile(profile, input.minR, input.maxR);
      const conf = computeProfileConfidence(profile, best.bin, best.val);
      const floor = best.bin >= 0 ? floorMedian(profile, best.bin) : 1e-12;
      const snrDb = best.val > 0 ? 10 * Math.log10(best.val / floor) : -60;

      snrDbValues.push(snrDb);
      psrValues.push(conf.psr);
      rangeValues.push(Number.isFinite(best.range) ? best.range : 0);

      const detected = best.bin >= 0
        && best.val > input.strengthGate * 0.7
        && conf.confidence >= input.confidenceGate * 0.5;
      detectionFlags.push(detected);

      if (i < repeats - 1) await sleep(gapMs);
    }

    scored.push(scoreCarrier(freqHz, snrDbValues, psrValues, rangeValues, detectionFlags));
  }

  const selectedCount = Math.max(1, Math.floor(clamp(input.config.carrierCount, 1, 16)));
  const minSpacingHz = Math.max(20, input.config.minSpacingHz);
  return selectBestCarrierSubset(scored, selectedCount, minSpacingHz);
}
