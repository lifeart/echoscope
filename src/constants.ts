export function speedOfSoundFromTemp(tempC: number): number {
  return 331.3 + 0.606 * tempC;
}

export const SPEED_OF_SOUND = speedOfSoundFromTemp(25); // m/s at 25°C
export const DEFAULT_SAMPLE_RATE = 48000;
export const DEFAULT_BUFFER_SECONDS = 2.2;
export const DEFAULT_HEAT_BINS = 240;
export const MIN_FREQUENCY = 800;
export const MAX_FREQUENCY = 12000;
export const FADE_SAMPLES = 192;

export const DEFAULT_CHIRP = { f1: 2000, f2: 9000, durationMs: 7 } as const;
export const DEFAULT_MLS = { order: 12, chipRate: 4000 } as const;
export const DEFAULT_GOLAY = { order: 10, chipRate: 5000, gapMs: 12 } as const;

export const DEFAULT_SCAN = {
  step: 10,
  dwell: 140,
  minAngle: -60,
  maxAngle: 60,
} as const;

export const DEFAULT_CALIBRATION = {
  repeats: 3,
  gapMs: 120,
  extraPings: 4,
  earlyMs: 60,
} as const;

export interface DevicePreset {
  name: string;
  d: number | null;
  mic: { x: number | null; y: number | null };
  micSpacing: number | null;
}

export const DEVICE_PRESETS: Record<string, DevicePreset> = {
  'mbp14':  { name: 'MacBook Pro 14\u2033',  d: 0.245, mic: { x: 0, y: 0.01 }, micSpacing: 0.055 },
  'mbp16':  { name: 'MacBook Pro 16\u2033',  d: 0.275, mic: { x: 0, y: 0.01 }, micSpacing: 0.055 },
  'mba13':  { name: 'MacBook Air 13\u2033',  d: 0.195, mic: { x: 0, y: 0.01 }, micSpacing: 0.045 },
  'mba15':  { name: 'MacBook Air 15\u2033',  d: 0.235, mic: { x: 0, y: 0.01 }, micSpacing: 0.045 },
  'iphone': { name: 'iPhone (portrait)',      d: 0.140, mic: { x: 0.05, y: 0.01 }, micSpacing: 0.070 },
  'ipad11': { name: 'iPad Pro 11\u2033',      d: 0.180, mic: { x: 0, y: 0.005 }, micSpacing: 0.050 },
  'ipad13': { name: 'iPad Pro 13\u2033',      d: 0.215, mic: { x: 0, y: 0.005 }, micSpacing: 0.065 },
  'custom': { name: 'Custom',                 d: null,  mic: { x: null, y: null }, micSpacing: null },
};

export const LAPTOP_PRESET_SCAN = {
  mode: 'golay' as const,
  scanStep: 3,
  scanPasses: 2,
  strengthGate: 0.0001,
  clutterStrength: 0.70,
  qualityAlgo: 'auto' as const,
  extraCalPings: 6,
  envBaselineStrength: 0.60,
  micArraySpacing: 0.055,
};

export const QUALITY_WEIGHTS = {
  mad: 0.50,
  peak: 0.35,
  geom: 0.15,
} as const;

export const MONO_THRESHOLDS = {
  timeSec: 0.00007, // ~3.4 samples at 48kHz — truly identical channels only
  peakDiff: 0.05,   // tighter peak similarity
  expectDiffSec: 0.0003,
} as const;

// --- Multiband calibration ---

import type { BandConfig } from './types.js';

/** Default frequency bands for multiband calibration (Phase 1: 2 bands) */
export const MULTIBAND_BANDS: BandConfig[] = [
  { id: 'M', label: 'Mid (900–2500 Hz)',      fLow: 900,  fHigh: 2500, filterTaps: 129 },
  { id: 'H', label: 'High-mid (2500–5500 Hz)', fLow: 2500, fHigh: 5500, filterTaps: 129 },
];

/** Optional low band (Phase 2+ fallback) */
export const MULTIBAND_BAND_L: BandConfig = {
  id: 'L', label: 'Low-mid (300–900 Hz)', fLow: 300, fHigh: 900, filterTaps: 257,
};

/** Cross-band agreement window: two bands agree if |pilotTauA - pilotTauB| < this */
export const MULTIBAND_AGREE_WIN = 0.0005; // 0.5 ms

/** Calibration constants used by band runner */
export const BAND_CALIB = {
  TAU_MIN_ACOUSTIC: 0.0006,    // 0.6 ms coupling rejection floor
  PILOT_PINGS: 8,
  PILOT_CLUSTER_WIN: 0.0008,   // 0.8 ms pilot clustering diameter
  CLUSTER_WINDOW: 0.0005,      // 0.5 ms repeat clustering diameter
  EARLY_MS: 60,
} as const;
