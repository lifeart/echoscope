// --- Audio ---
export interface AudioConfig {
  sampleRate: number;
  channelCount: number;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  latencyHint: AudioContextLatencyCategory;
  bufferSeconds: number;
}

export interface AudioState {
  context: AudioContext | null;
  actualSampleRate: number;
  channelCount: number;
  baseLatency: number;
  outputLatency: number;
  captureMethod: 'worklet' | 'script-processor';
  isRunning: boolean;
}

// --- Probes ---
export type ProbeType = 'chirp' | 'mls' | 'golay' | 'multiplex';

export interface ChirpConfig { f1: number; f2: number; durationMs: number; }
export interface MLSConfig { order: number; chipRate: number; }
export interface GolayConfig { order: number; chipRate: number; gapMs: number; }
export type MultiplexFusionMode = 'snrWeighted' | 'median' | 'trimmedMean';
export interface MultiplexConfig {
  carrierCount: number;
  fStart: number;
  fEnd: number;
  symbolMs: number;
  guardHz: number;
  minSpacingHz: number;
  calibrationCandidates: number;
  fusion: MultiplexFusionMode;
  activeCarrierHz?: number[];
  carrierWeights?: number[];
  fallbackToChirp?: boolean;
}
export type ProbeConfig =
  | { type: 'chirp'; params: ChirpConfig }
  | { type: 'mls'; params: MLSConfig }
  | { type: 'golay'; params: GolayConfig }
  | { type: 'multiplex'; params: MultiplexConfig };

export interface ProbeSignal {
  type: ProbeType;
  ref?: Float32Array;
  a?: Float32Array;
  b?: Float32Array;
  gapMs?: number;
  refsByCarrier?: Float32Array[];
  carrierHz?: number[];
}

export interface SubcarrierStat {
  frequencyHz: number;
  snrDb: number;
  psr: number;
  confidence: number;
  weight: number;
}

export interface MultiplexDebugInfo {
  activeCarrierCount: number;
  usedCarrierHz: number[];
  stats: SubcarrierStat[];
}

// --- DSP ---
export interface CorrelationResult {
  correlation: Float32Array;
  tau0: number;
  method: 'time-domain' | 'fft' | 'gcc-phat';
}

export interface RangeProfile {
  bins: Float32Array;
  minRange: number;
  maxRange: number;
  binCount: number;
  bestBin: number;
  bestRange: number;
  bestStrength: number;
}

export type VirtualArrayWindow = 'hann' | 'gaussian';

export interface VirtualArrayConfig {
  enabled: boolean;
  halfWindow: number;
  window: VirtualArrayWindow;
  phaseCenterHz: number;
  coherenceFloor: number;
  maxTauShiftSamples: number;
}

export type SaftConfig = VirtualArrayConfig;

export interface RawAngleFrame {
  angleDeg: number;
  sampleRate: number;
  tau0: number;
  corrReal: Float32Array;
  corrImag: Float32Array;
  centerFreqHz: number;
  quality: number;
}

export interface PingDetailedResult {
  profile: RangeProfile;
  rawFrame: RawAngleFrame;
}

// --- Spatial ---
export interface ArrayGeometry {
  speakers: Array<{ x: number; y: number; z: number }>;
  microphones: Array<{ x: number; y: number; z: number }>;
  spacing: number;
  speedOfSound: number;
}

export interface SteeringVector {
  angleDeg: number;
  delaysSeconds: Float32Array;
}

export interface DOAEstimate {
  azimuthDeg: number;
  elevationDeg: number;
  confidence: number;
  method: 'scan-peak' | 'music' | 'srp-phat';
}

// --- Calibration ---

/** Frequency band configuration for multiband calibration */
export interface BandConfig {
  /** Band identifier */
  id: string;
  /** Human-readable label */
  label: string;
  /** Lower cutoff frequency (Hz) */
  fLow: number;
  /** Upper cutoff frequency (Hz) */
  fHigh: number;
  /** FIR filter tap count (odd) */
  filterTaps: number;
}

/** Per-band calibration result from band runner */
export interface BandCalibrationResult {
  bandId: string;
  bandHz: [number, number];
  valid: boolean;
  quality: number;
  angleReliable: boolean;
  pilotTau: number;
  pilotMAD: number;
  pilotClusterSize: number;
  pilotAboveFloor: boolean;
  pilotWin: number;
  repeatClusterSize: number;
  softFilteredCount: number;
  deltaConsistency: number;
  maxDeltaDev: number;
  corrQualOk: boolean;
  tauMeasured: { L: number; R: number };
  tauMAD: { L: number; R: number };
  peaks: { L: number; R: number };
  deltaTau: number;
  monoLikely: boolean;
}

/** Multiband fusion summary attached to CalibrationResult */
export interface MultibandInfo {
  /** Which band was selected as the final answer */
  selectedBand: string;
  /** How many bands agreed on the same acoustic mode */
  bandAgreementCount: number;
  /** Per-band results for diagnostics */
  bandResults: BandCalibrationResult[];
  /** Why this band was selected */
  selectionReason: 'agreement' | 'best-quality' | 'only-valid' | 'fallback';
}

export interface CalibrationResult {
  valid: boolean;
  quality: number;
  /** True when per-repeat TDOA deltas are consistent (maxDeltaDev < 0.6).
   *  When false, calibration is still usable for range but angle is less reliable. */
  angleReliable: boolean;
  monoLikely: boolean;
  tauMeasured: { L: number; R: number };
  tauMAD: { L: number; R: number };
  peaks: { L: number; R: number };
  distances: { L: number; R: number };
  micPosition: { x: number; y: number };
  systemDelay: { common: number; L: number; R: number };
  geometryError: number;
  envBaseline: Float32Array | null;
  envBaselinePings: number;
  sanity: CalibrationSanity;
  /** Multiband info (present when multiband calibration was used) */
  multiband?: MultibandInfo;
  /** Carrier qualification results for multiplex mode */
  carrierCalibration?: CarrierCalibrationResult;
}

export interface CarrierCalibrationCandidate {
  frequencyHz: number;
  snrDb: number;
  psr: number;
  stability: number;
  detectRate: number;
  score: number;
  selected: boolean;
  rejectionReason?: 'snr' | 'psr' | 'stability' | 'spacing' | 'floor';
}

export interface CarrierCalibrationResult {
  activeCarrierHz: number[];
  carrierWeights: number[];
  minSpacingHz: number;
  candidates: CarrierCalibrationCandidate[];
  computedAtMs: number;
}

export interface CalibrationSanity {
  have: boolean;
  curveL: Float32Array | null;
  curveR: Float32Array | null;
  peakIndexL: number;
  peakIndexR: number;
  earlyMs: number;
  tauL: number;
  tauR: number;
  peakL: number;
  peakR: number;
  monoAssessment: MonoAssessment;
}

export interface MonoAssessment {
  dt: number;
  dp: number;
  monoByTime: boolean;
  monoByRelTime: boolean;
  monoByPeak: boolean;
  expectDiff: boolean;
  monoLikely: boolean;
}

// --- Tracking ---
export interface TargetState {
  id: number;
  position: { range: number; angleDeg: number };
  velocity: { rangeRate: number; angleRate: number };
  covariance: Float64Array;
  age: number;
  missCount: number;
  confidence: number;
}

export interface Measurement {
  range: number;
  angleDeg: number;
  strength: number;
  timestamp: number;
}

// --- Network ---
export interface PeerNode {
  id: string;
  connection: RTCPeerConnection;
  dataChannel: RTCDataChannel;
  clockOffset: number;
  geometry: ArrayGeometry;
  lastHeartbeat: number;
}

export interface SyncedAudioChunk {
  peerId: string;
  timestamp: number;
  sampleRate: number;
  channels: Float32Array[];
  probeConfig: ProbeConfig;
}

// --- Heatmap ---
export interface HeatmapData {
  angles: number[];
  bins: number;
  data: Float32Array;
  display: Float32Array;
  bestBin: Int16Array;
  bestVal: Float32Array;
}

// --- Colormap ---
export type ColormapName = 'grayscale' | 'inferno' | 'viridis';

// --- Quality ---
export type QualityAlgo = 'auto' | 'fast' | 'balanced' | 'max';
export type ScanAggregateMode = 'mean' | 'median' | 'trimmedMean';

export interface QualityPerf {
  ewmaMs: number;
  lastResolved: string;
  lastSwitchAt: number;
}

export interface AdaptiveQualityConfig {
  enabled: boolean;
  hysteresisMs: number;
}

export interface SubtractionBackoffConfig {
  enabled: boolean;
  collapseThreshold: number;
  peakDropThreshold: number;
}

export interface DisplayReflectionBlankingConfig {
  enabled: boolean;
  startRange: number;
  endRange: number;
  attenuation: number;
  edgeSoftness: number;
}

// --- Geometry Wizard ---
export interface GeomHandle {
  u: number;
  f: number;
}

export interface GeomWizardState {
  active: boolean;
  touched: boolean;
  dragging: string | null;
  handles: {
    spL: GeomHandle;
    spR: GeomHandle;
    mic: GeomHandle;
  };
}

// --- Store ---
export interface AppState {
  audio: AudioState;
  calibration: CalibrationResult | null;
  geometry: ArrayGeometry;
  heatmap: HeatmapData | null;
  lastProfile: {
    corr: Float32Array | null;
    tau0: number;
    c: number;
    minR: number;
    maxR: number;
  };
  lastTarget: {
    angle: number;
    range: number;
    strength: number;
  };
  lastDirection: {
    angle: number;
    strength: number;
  };
  presetMicPosition: { x: number | null; y: number | null };
  qualityPerf: QualityPerf;
  geomWizard: GeomWizardState;
  scanning: boolean;
  status: 'idle' | 'initializing' | 'ready' | 'pinging' | 'scanning' | 'calibrating' | 'error';
  targets: TargetState[];
  peers: Map<string, PeerNode>;
  config: AppConfig;
}

export interface AppConfig {
  probe: ProbeConfig;
  steeringAngleDeg: number;
  gain: number;
  listenMs: number;
  minRange: number;
  maxRange: number;
  scanStep: number;
  scanDwell: number;
  scanPasses: number;
  strengthGate: number;
  confidenceGate: number;
  scanAggregateMode: ScanAggregateMode;
  scanTrimFraction: number;
  temporalIirAlpha: number;
  outlierHistoryN: number;
  continuityBins: number;
  qualityAlgo: QualityAlgo;
  adaptiveQuality: AdaptiveQualityConfig;
  directionAxis: 'horizontal' | 'vertical';
  clutterSuppression: { enabled: boolean; strength: number };
  displayReflectionBlanking: DisplayReflectionBlankingConfig;
  envBaseline: { enabled: boolean; strength: number; pings: number };
  subtractionBackoff: SubtractionBackoffConfig;
  calibration: { repeats: number; gapMs: number; useCalib: boolean; multiband: boolean };
  devicePreset: string;
  heatBins: number;
  speedOfSound: number;
  temperature: number;
  spacing: number;
  micArraySpacing: number;
  trackViz: {
    trailMaxPoints: number;
    fadeMissCount: number;
    trailMinAlpha: number;
    trailMaxAlpha: number;
    minConfidenceFloor: number;
  };
  virtualArray: VirtualArrayConfig;
  colormap: ColormapName;
  heatmapDbScale: boolean;
  heatmapDynamicRangeDb: number;
  crossAngleSmooth: { enabled: boolean; radius: number };
  cfar: { guardCells: number; trainingCells: number; pfa: number; minThreshold: number };
  coherentIntegrationDepth: number;
}

// --- Events ---
export interface AppEvents {
  'ping:start': { angleDeg: number };
  'ping:complete': { angleDeg: number; profile: RangeProfile };
  'scan:step': { angleDeg: number; index: number; total: number; pass: number; totalPasses: number };
  'scan:complete': void;
  'calibration:done': CalibrationResult;
  'target:updated': TargetState[];
  'peer:connected': { peerId: string };
  'peer:data': SyncedAudioChunk;
  'state:changed': { path: string; value: unknown };
  'audio:initialized': AudioState;
  'audio:samples': Float32Array;
}
