import type { AppState, AppConfig } from '../types.js';
import { DEFAULT_HEAT_BINS, SPEED_OF_SOUND, speedOfSoundFromTemp } from '../constants.js';

type Listener = (value: unknown) => void;

function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setByPath(obj: unknown, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current == null || typeof current !== 'object') return;
    current = (current as Record<string, unknown>)[parts[i]];
  }
  if (current != null && typeof current === 'object') {
    (current as Record<string, unknown>)[parts[parts.length - 1]] = value;
  }
}

// Derive consistent defaults from temperature=25, maxRange=4, spacing=0.20
const _defaultC = speedOfSoundFromTemp(25);
const _defaultListenMs = (2 * 4.0 / _defaultC) * 1000 + 50;

const defaultConfig: AppConfig = {
  probe: { type: 'golay', params: { order: 11, chipRate: 6000, gapMs: 15 } },
  distributed: { enabled: false, captureTimeoutMs: 300 },
  spectrogram: {
    enabled: true,
    fftSize: 512,
    hopSize: 128,
    minDb: -90,
    maxDb: -20,
    fps: 24,
  },
  steeringAngleDeg: 0,
  gain: 0.80,
  listenMs: _defaultListenMs,
  minRange: 0.3,
  maxRange: 4.0,
  scanStep: 10,
  scanDwell: _defaultListenMs,
  scanPasses: 1,
  strengthGate: 0.0001,
  confidenceGate: 0.38,
  scanAggregateMode: 'trimmedMean',
  scanTrimFraction: 0.2,
  temporalIirAlpha: 0.18,
  outlierHistoryN: 7,
  continuityBins: 8,
  qualityAlgo: 'balanced',
  adaptiveQuality: { enabled: true, hysteresisMs: 1200 },
  directionAxis: 'horizontal',
  clutterSuppression: { enabled: true, strength: 0.45 },
  displayReflectionBlanking: {
    enabled: false,
    startRange: 0.30,
    endRange: 0.90,
    attenuation: 0.85,
    edgeSoftness: 0.08,
  },
  envBaseline: { enabled: true, strength: 0.40, pings: 4 },
  noiseKalman: {
    enabled: true,
    processNoiseQ: 1e-5,
    measurementNoiseR: 5e-4,
    subtractStrength: 0.40,
    freezeOnHighConfidence: true,
    highConfidenceGate: 0.68,
    minFloor: 0,
    maxFloor: 1,
    useInCalibration: false,
  },
  subtractionBackoff: { enabled: true, collapseThreshold: 0.24, peakDropThreshold: 0.30 },
  calibration: { repeats: 5, gapMs: 120, useCalib: true, multiband: true },
  devicePreset: 'custom',
  heatBins: DEFAULT_HEAT_BINS,
  speedOfSound: SPEED_OF_SOUND,
  temperature: 25,
  spacing: 0.20,
  micArraySpacing: 0,
  trackViz: {
    trailMaxPoints: 22,
    fadeMissCount: 8,
    trailMinAlpha: 0.08,
    trailMaxAlpha: 0.55,
    minConfidenceFloor: 0.0001,
  },
  virtualArray: {
    enabled: false,
    halfWindow: 3,
    window: 'hann',
    phaseCenterHz: 4000,
    coherenceFloor: 0.25,
    maxTauShiftSamples: 192,
  },
  showTrace: true,
  presetApplyScan: false,
  colormap: 'inferno',
  heatmapDbScale: false,
  heatmapDynamicRangeDb: 40,
  crossAngleSmooth: { enabled: true, radius: 1 },
  cfar: { guardCells: 2, trainingCells: 8, pfa: 1e-3, minThreshold: 1e-6 },
  coherentIntegrationDepth: 1,
};

function createInitialState(): AppState {
  return {
    audio: {
      context: null,
      actualSampleRate: 48000,
      channelCount: 1,
      baseLatency: 0,
      outputLatency: 0,
      captureMethod: 'worklet',
      isRunning: false,
    },
    calibration: null,
    geometry: {
      speakers: [{ x: -0.1, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }],
      microphones: [{ x: 0, y: 0.01, z: 0 }],
      spacing: 0.20,
      speedOfSound: SPEED_OF_SOUND,
    },
    heatmap: null,
    lastProfile: { corr: null, tau0: 0, c: SPEED_OF_SOUND, minR: 0.3, maxR: 4.0 },
    lastTarget: { angle: NaN, range: NaN, strength: 0 },
    lastDirection: { angle: NaN, strength: 0 },
    presetMicPosition: { x: null, y: null },
    qualityPerf: { ewmaMs: 7, lastResolved: 'balanced', lastSwitchAt: 0 },
    geomWizard: {
      active: false,
      touched: false,
      dragging: null,
      handles: {
        spL: { u: -0.1, f: 0 },
        spR: { u: 0.1, f: 0 },
        mic: { u: 0, f: 0.12 },
      },
    },
    scanning: false,
    status: 'idle',
    targets: [],
    peers: new Map(),
    config: { ...defaultConfig },
  };
}

export class Store {
  private state: AppState;
  private subscribers = new Map<string, Set<Listener>>();
  private globalSubscribers = new Set<Listener>();

  constructor() {
    this.state = createInitialState();
  }

  get(): AppState {
    return this.state;
  }

  getPath<T = unknown>(path: string): T {
    return getByPath(this.state, path) as T;
  }

  set(path: string, value: unknown): void {
    setByPath(this.state, path, value);
    this.notify(path, value);
  }

  update(fn: (state: AppState) => void): void {
    fn(this.state);
    // Notify all path-specific subscribers (update mutates state arbitrarily,
    // so we cannot know which paths changed — notify all of them).
    for (const [path, listeners] of this.subscribers) {
      const value = getByPath(this.state, path);
      for (const fn of listeners) {
        try { fn(value); } catch (e) { console.error(`Store listener error for '${path}':`, e); }
      }
    }
    this.notifyGlobal();
  }

  subscribe(path: string, listener: Listener): () => void {
    if (!this.subscribers.has(path)) {
      this.subscribers.set(path, new Set());
    }
    this.subscribers.get(path)!.add(listener);
    return () => { this.subscribers.get(path)?.delete(listener); };
  }

  subscribeAll(listener: Listener): () => void {
    this.globalSubscribers.add(listener);
    return () => { this.globalSubscribers.delete(listener); };
  }

  private notify(path: string, value: unknown): void {
    // Notify exact path subscribers
    this.subscribers.get(path)?.forEach(fn => {
      try { fn(value); } catch (e) { console.error(`Store listener error for '${path}':`, e); }
    });
    // Notify parent path subscribers
    const parts = path.split('.');
    for (let i = parts.length - 1; i > 0; i--) {
      const parentPath = parts.slice(0, i).join('.');
      const parentValue = getByPath(this.state, parentPath);
      this.subscribers.get(parentPath)?.forEach(fn => {
        try { fn(parentValue); } catch (e) { console.error(`Store listener error for '${parentPath}':`, e); }
      });
    }
    this.notifyGlobal();
  }

  private notifyGlobal(): void {
    for (const fn of this.globalSubscribers) {
      try { fn(this.state); } catch (e) { console.error('Store global listener error:', e); }
    }
  }

  reset(): void {
    this.state = createInitialState();
    this.notifyGlobal();
  }
}

export const store = new Store();
