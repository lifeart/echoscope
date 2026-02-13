import { clamp } from '../utils.js';
import type { RawAngleFrame, SaftConfig } from '../types.js';

export interface SaftBuildInput {
  rawFrames: RawAngleFrame[];
  scanAngles: number[];
  minRange: number;
  maxRange: number;
  bins: number;
  spacing: number;
  speedOfSound: number;
  config: SaftConfig;
}

export interface SaftHeatmapResult {
  angles: number[];
  bins: number;
  data: Float32Array;
  coherence: Float32Array;
  bestBin: Int16Array;
  bestVal: Float32Array;
}

export function computeExpectedTauShift(
  targetAngleDeg: number,
  sourceAngleDeg: number,
  rangeMeters: number,
  spacing: number,
  speedOfSound: number,
): number {
  if (!(Number.isFinite(rangeMeters) && rangeMeters > 0)) return 0;
  if (!(Number.isFinite(spacing) && spacing > 0)) return 0;
  if (!(Number.isFinite(speedOfSound) && speedOfSound > 0)) return 0;

  const targetSin = Math.sin((targetAngleDeg * Math.PI) / 180);
  const sourceSin = Math.sin((sourceAngleDeg * Math.PI) / 180);
  const apertureOffset = spacing * (sourceSin - targetSin);
  if (Math.abs(apertureOffset) < 1e-12) return 0;

  const extraPath = Math.hypot(rangeMeters, apertureOffset) - rangeMeters;
  const sign = apertureOffset >= 0 ? 1 : -1;
  return (2 * sign * extraPath) / speedOfSound;
}

export function interpolateComplexAt(
  real: Float32Array,
  imag: Float32Array,
  sampleIndex: number,
): { real: number; imag: number; valid: boolean } {
  const len = Math.min(real.length, imag.length);
  if (len <= 0 || !Number.isFinite(sampleIndex)) return { real: 0, imag: 0, valid: false };

  if (sampleIndex < 0 || sampleIndex > len - 1) {
    return { real: 0, imag: 0, valid: false };
  }

  if (len === 1) {
    return { real: real[0], imag: imag[0], valid: true };
  }

  const i0 = Math.floor(sampleIndex);
  const i1 = Math.min(len - 1, i0 + 1);
  const frac = sampleIndex - i0;

  const r = real[i0] + (real[i1] - real[i0]) * frac;
  const im = imag[i0] + (imag[i1] - imag[i0]) * frac;
  return { real: r, imag: im, valid: true };
}

export function apertureWeight(distance: number, halfWindow: number, mode: SaftConfig['window']): number {
  const d = Math.abs(distance);
  if (halfWindow <= 0) return d === 0 ? 1 : 0;
  if (d > halfWindow) return 0;

  if (mode === 'hann') {
    return 0.5 * (1 + Math.cos((Math.PI * d) / halfWindow));
  }

  const sigma = Math.max(0.5, halfWindow / 2);
  const x = d / sigma;
  return Math.exp(-0.5 * x * x);
}

function resolveAngleTolerance(scanAngles: number[]): number {
  if (scanAngles.length < 2) return 0.25;

  let minStep = Infinity;
  for (let i = 1; i < scanAngles.length; i++) {
    const step = Math.abs(scanAngles[i] - scanAngles[i - 1]);
    if (step > 1e-9 && step < minStep) minStep = step;
  }

  if (!Number.isFinite(minStep)) return 0.25;
  return Math.max(1e-4, 0.45 * minStep);
}

function buildRowFrameLookup(rawFrames: RawAngleFrame[], scanAngles: number[]): Array<RawAngleFrame | null> {
  const lookup: Array<RawAngleFrame | null> = new Array(scanAngles.length).fill(null);
  const tol = resolveAngleTolerance(scanAngles);

  for (let row = 0; row < scanAngles.length; row++) {
    const targetAngle = scanAngles[row];
    let best: RawAngleFrame | null = null;
    let bestDiff = Infinity;

    const byIndex = rawFrames[row];
    if (byIndex) {
      const diff = Math.abs(byIndex.angleDeg - targetAngle);
      if (diff <= tol) {
        lookup[row] = byIndex;
        continue;
      }
      best = byIndex;
      bestDiff = diff;
    }

    for (let i = 0; i < rawFrames.length; i++) {
      const frame = rawFrames[i];
      const diff = Math.abs(frame.angleDeg - targetAngle);
      if (diff < bestDiff) {
        best = frame;
        bestDiff = diff;
      }
    }

    lookup[row] = bestDiff <= tol ? best : null;
  }

  return lookup;
}

function getFrameForRow(rowIndex: number, rawFrames: RawAngleFrame[], scanAngles: number[]): RawAngleFrame | null {
  if (rowIndex < 0 || rowIndex >= scanAngles.length) return null;
  return buildRowFrameLookup(rawFrames, scanAngles)[rowIndex];
}

function resolvePhaseCenterHz(cfg: SaftConfig, frame: RawAngleFrame): number {
  if (Number.isFinite(cfg.phaseCenterHz) && cfg.phaseCenterHz > 0) return cfg.phaseCenterHz;
  if (Number.isFinite(frame.centerFreqHz) && frame.centerFreqHz > 0) return frame.centerFreqHz;
  return 4000;
}

export function coherentSumCell(
  targetRowIndex: number,
  rangeMeters: number,
  rawFrames: RawAngleFrame[],
  scanAngles: number[],
  config: SaftConfig,
  spacing: number,
  speedOfSound: number,
  rowFrameLookup?: Array<RawAngleFrame | null>,
): { intensity: number; coherence: number } {
  if (targetRowIndex < 0 || targetRowIndex >= scanAngles.length) return { intensity: 0, coherence: 0 };
  if (!(Number.isFinite(rangeMeters) && rangeMeters > 0)) return { intensity: 0, coherence: 0 };

  const effectiveHalfWindow = Math.max(0, Math.floor(config.halfWindow));
  const start = Math.max(0, targetRowIndex - effectiveHalfWindow);
  const end = Math.min(scanAngles.length - 1, targetRowIndex + effectiveHalfWindow);

  let sumReal = 0;
  let sumImag = 0;
  let incoherentSum = 0;
  let weightSum = 0;

  const targetAngle = scanAngles[targetRowIndex];

  for (let row = start; row <= end; row++) {
    const frame = rowFrameLookup ? rowFrameLookup[row] : getFrameForRow(row, rawFrames, scanAngles);
    if (!frame) continue;

    const sourceAngle = scanAngles[row];
    const shiftSec = computeExpectedTauShift(targetAngle, sourceAngle, rangeMeters, spacing, speedOfSound);
    const maxShiftSec = Math.max(0, config.maxTauShiftSamples) / Math.max(1, frame.sampleRate);
    if (Math.abs(shiftSec) > maxShiftSec) continue;

    const tauAtRange = (2 * rangeMeters) / speedOfSound;
    const sampleIndex = (frame.tau0 + tauAtRange + shiftSec) * frame.sampleRate;
    const sampled = interpolateComplexAt(frame.corrReal, frame.corrImag, sampleIndex);
    if (!sampled.valid) continue;

    const phaseHz = resolvePhaseCenterHz(config, frame);
    const phase = -2 * Math.PI * phaseHz * shiftSec;
    const c = Math.cos(phase);
    const s = Math.sin(phase);
    const rotatedReal = sampled.real * c - sampled.imag * s;
    const rotatedImag = sampled.real * s + sampled.imag * c;

    const baseWeight = apertureWeight(Math.abs(row - targetRowIndex), effectiveHalfWindow, config.window);
    if (baseWeight <= 0) continue;
    const quality = Number.isFinite(frame.quality) ? clamp(frame.quality, 0, 1) : 1;
    const weight = baseWeight * (0.25 + 0.75 * quality);

    sumReal += weight * rotatedReal;
    sumImag += weight * rotatedImag;
    incoherentSum += weight * Math.hypot(rotatedReal, rotatedImag);
    weightSum += weight;
  }

  if (weightSum <= 1e-12) return { intensity: 0, coherence: 0 };

  const coherentMag = Math.hypot(sumReal, sumImag) / weightSum;
  const incoherentMag = incoherentSum / weightSum;
  const coherence = incoherentMag > 1e-12 ? clamp(coherentMag / incoherentMag, 0, 1) : 0;
  const coherentFocused = coherentMag * coherence;

  const floor = clamp(config.coherenceFloor, 0, 1);
  let intensity = coherentFocused;
  if (floor > 0 && coherence < floor) {
    const blend = clamp(coherence / floor, 0, 1);
    intensity = blend * coherentFocused + (1 - blend) * incoherentMag;
  }

  return { intensity, coherence };
}

export function buildSaftHeatmap(input: SaftBuildInput): SaftHeatmapResult {
  const rows = input.scanAngles.length;
  const bins = Math.max(0, Math.floor(input.bins));
  const total = rows * bins;

  const data = new Float32Array(total);
  const coherence = new Float32Array(total);
  const bestBin = new Int16Array(rows).fill(-1);
  const bestVal = new Float32Array(rows);

  if (rows === 0 || bins === 0) {
    return {
      angles: input.scanAngles.slice(),
      bins,
      data,
      coherence,
      bestBin,
      bestVal,
    };
  }

  const effectiveConfig: SaftConfig = input.config.enabled
    ? input.config
    : { ...input.config, halfWindow: 0 };
  const rowFrameLookup = buildRowFrameLookup(input.rawFrames, input.scanAngles);

  const rangeSpan = input.maxRange - input.minRange;
  const rangeDen = Math.max(1, bins - 1);

  for (let row = 0; row < rows; row++) {
    let rowBestVal = 0;
    let rowBestBin = -1;

    for (let b = 0; b < bins; b++) {
      const rangeMeters = input.minRange + (b / rangeDen) * rangeSpan;
      const cell = coherentSumCell(
        row,
        rangeMeters,
        input.rawFrames,
        input.scanAngles,
        effectiveConfig,
        input.spacing,
        input.speedOfSound,
        rowFrameLookup,
      );

      const idx = row * bins + b;
      data[idx] = cell.intensity;
      coherence[idx] = cell.coherence;

      if (cell.intensity > rowBestVal) {
        rowBestVal = cell.intensity;
        rowBestBin = b;
      }
    }

    bestBin[row] = rowBestBin;
    bestVal[row] = rowBestVal;
  }

  return {
    angles: input.scanAngles.slice(),
    bins,
    data,
    coherence,
    bestBin,
    bestVal,
  };
}
