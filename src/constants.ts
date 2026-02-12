export const SPEED_OF_SOUND = 343; // m/s at ~20°C
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
}

export const DEVICE_PRESETS: Record<string, DevicePreset> = {
  'mbp14':  { name: 'MacBook Pro 14\u2033',  d: 0.245, mic: { x: 0, y: 0.01 } },
  'mbp16':  { name: 'MacBook Pro 16\u2033',  d: 0.275, mic: { x: 0, y: 0.01 } },
  'mba13':  { name: 'MacBook Air 13\u2033',  d: 0.195, mic: { x: 0, y: 0.01 } },
  'mba15':  { name: 'MacBook Air 15\u2033',  d: 0.235, mic: { x: 0, y: 0.01 } },
  'iphone': { name: 'iPhone (portrait)',      d: 0.140, mic: { x: 0.05, y: 0.01 } },
  'ipad11': { name: 'iPad Pro 11\u2033',      d: 0.180, mic: { x: 0, y: 0.005 } },
  'ipad13': { name: 'iPad Pro 13\u2033',      d: 0.215, mic: { x: 0, y: 0.005 } },
  'custom': { name: 'Custom',                 d: null,  mic: { x: null, y: null } },
};

export const LAPTOP_PRESET_SCAN = {
  mode: 'golay' as const,
  scanStep: 3,
  scanDwell: 220,
  listenMs: 180,
  strengthGate: 0.05,
  clutterStrength: 0.70,
  qualityAlgo: 'auto' as const,
  extraCalPings: 6,
  envBaselineStrength: 0.60,
};

export const QUALITY_WEIGHTS = {
  mad: 0.45,
  peak: 0.35,
  geom: 0.20,
} as const;

export const MONO_THRESHOLDS = {
  timeSec: 0.00015,
  peakDiff: 0.07,
  expectDiffSec: 0.0003,
} as const;
