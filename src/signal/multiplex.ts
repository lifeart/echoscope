import type { MultiplexConfig } from '../types.js';
import { clamp } from '../utils.js';
import { MAX_FREQUENCY, MIN_FREQUENCY } from '../constants.js';
import { hann } from './window.js';

export interface MultiplexSignal {
  ref: Float32Array;
  refsByCarrier: Float32Array[];
  carrierHz: number[];
}

function normalizeAbsMax(signal: Float32Array, target = 0.98): void {
  let mx = 0;
  for (let i = 0; i < signal.length; i++) {
    const v = Math.abs(signal[i]);
    if (v > mx) mx = v;
  }
  if (mx <= 1e-12) return;
  const scale = target / mx;
  for (let i = 0; i < signal.length; i++) signal[i] *= scale;
}

function pickCarriers(
  cfg: MultiplexConfig,
  sampleRate: number,
): { carrierHz: number[]; nSamples: number } {
  const symbolMs = Math.max(2, cfg.symbolMs);
  const nSamples = Math.max(32, Math.floor(sampleRate * (symbolMs / 1000)));
  const binHz = sampleRate / nSamples;
  const nyquistSafe = Math.min(MAX_FREQUENCY, 0.45 * sampleRate);

  const fLo = clamp(Math.min(cfg.fStart, cfg.fEnd), MIN_FREQUENCY, nyquistSafe);
  const fHi = clamp(Math.max(cfg.fStart, cfg.fEnd), MIN_FREQUENCY, nyquistSafe);

  const requestedCount = Math.max(1, Math.floor(cfg.carrierCount));
  const minOrthSpacing = Math.max(1 / (symbolMs / 1000), cfg.guardHz, cfg.minSpacingHz, binHz);

  const seeded = (cfg.activeCarrierHz && cfg.activeCarrierHz.length > 0)
    ? cfg.activeCarrierHz.slice(0, requestedCount)
    : null;

  const carriers: number[] = [];
  const minSpacing = minOrthSpacing * 0.8;
  const tryAddCarrier = (rawHz: number): void => {
    const quantized = Math.round(rawHz / binHz) * binHz;
    if (quantized < fLo || quantized > fHi) return;
    if (carriers.some(existing => Math.abs(existing - quantized) < minSpacing)) return;
    carriers.push(quantized);
  };

  if (seeded) {
    for (const freq of seeded) {
      tryAddCarrier(clamp(freq, fLo, fHi));
    }
  }

  if (carriers.length < requestedCount) {
    if (requestedCount === 1) {
      tryAddCarrier(0.5 * (fLo + fHi));
    } else {
      const span = Math.max(0, fHi - fLo);
      const spacing = Math.max(minOrthSpacing, span / Math.max(1, requestedCount - 1));
      let f = fLo;
      let attempts = 0;
      while (carriers.length < requestedCount && attempts < requestedCount * 8) {
        tryAddCarrier(f);
        f += spacing;
        attempts++;
        if (f > fHi + 1e-6) f = fLo + (attempts * 0.37 % 1) * Math.max(binHz, span);
      }

      if (carriers.length < requestedCount && span > 0) {
        const sweepBins = Math.max(8, requestedCount * 3);
        for (let i = 0; i < sweepBins && carriers.length < requestedCount; i++) {
          const alpha = sweepBins <= 1 ? 0.5 : i / (sweepBins - 1);
          tryAddCarrier(fLo + alpha * span);
        }
      }
    }
  }

  if (carriers.length === 0) tryAddCarrier(0.5 * (fLo + fHi));

  carriers.sort((a, b) => a - b);
  return { carrierHz: carriers, nSamples };
}

export function genMultiplex(config: MultiplexConfig, sampleRate: number): MultiplexSignal {
  const { carrierHz, nSamples } = pickCarriers(config, sampleRate);
  const refsByCarrier: Float32Array[] = [];
  const ref = new Float32Array(nSamples);

  const fallbackWeights = new Array<number>(carrierHz.length).fill(1);
  const weightsRaw = (config.carrierWeights && config.carrierWeights.length > 0)
    ? config.carrierWeights.slice(0, carrierHz.length)
    : fallbackWeights;
  const weightNorm = Math.max(1e-6, Math.sqrt(weightsRaw.reduce((acc, value) => acc + value * value, 0)));
  const weights = weightsRaw.map(value => Math.max(0, value) / weightNorm);

  for (let ci = 0; ci < carrierHz.length; ci++) {
    const freq = carrierHz[ci];
    const phase = (2 * Math.PI * ci) / Math.max(1, carrierHz.length);
    const carrierRef = new Float32Array(nSamples);

    for (let n = 0; n < nSamples; n++) {
      const t = n / sampleRate;
      const w = hann(n, nSamples);
      const value = Math.sin(2 * Math.PI * freq * t + phase) * w;
      carrierRef[n] = value;
      ref[n] += value * weights[ci];
    }

    normalizeAbsMax(carrierRef, 1.0);
    refsByCarrier.push(carrierRef);
  }

  normalizeAbsMax(ref, 0.98);
  return { ref, refsByCarrier, carrierHz };
}
