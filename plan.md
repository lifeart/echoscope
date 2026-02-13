# Echoscope Refactoring Plan

## Context

## Scan Robustness Gap Plan (2026-02-13)

Code-audited status against requested scan improvements:

### Already wired

- Multi-pass per-angle scanning exists via `scanPasses` in `src/scan/scan-engine.ts`.
- SAFT post-focusing exists and is integrated (`src/scan/saft.ts` + `applySaftHeatmapIfEnabled`).
- RX beamforming is already used in scan ping path when `micArraySpacing > 0` (`src/scan/ping-cycle.ts`).
- Stereo capture is requested (`channelCount: 2`) in `src/audio/engine.ts`.

### Missing / incomplete features

1. **Adaptive confidence gating (missing)**
  - Current acceptance is mostly `bestVal > strengthGate`.
  - Add per-row confidence score: peak-to-local-floor + peak sharpness + sidelobe ratio.

2. **Neighborhood consensus winner selection (missing)**
  - Current scan end chooses global strongest row (`bestVal`).
  - Add 3-row smoothing plus `bestBin` continuity checks before selecting final direction.

3. **Robust multi-ping integration (partial)**
  - Multipass currently uses arithmetic mean.
  - Add robust aggregation option: median / trimmed mean (2-4 pings).

4. **Temporal IIR in data path (missing)**
  - Existing IIR is display-only (`display`), not fed into `data` accumulation.
  - Add optional temporal IIR update in `heatmap.data` before best-bin extraction.

5. **Per-angle outlier rejection (missing)**
  - No per-angle profile history + clustering in scan path.
  - Add N-profile history per angle and reject spikes via median/MAD clustering.

6. **Quality auto mode truly adaptive (missing)**
  - `qualityAlgo='auto'` is effectively hardwired to `'balanced'`.
  - Resolve `fast|balanced|max` from measured SNR/PSR with hysteresis.

7. **Self-limiting env/clutter subtraction (partial)**
  - Env-baseline fallback protects full-zero collapse only.
  - Add automatic subtraction-strength backoff when collapse ratio is high or peak drops too sharply.

8. **Selective clutter model update (missing)**
  - Clutter model updates all bins every ping, which can learn persistent targets.
  - Update only low-confidence/non-moving bins.

### Priority implementation order

#### P0: Stability first

1. Adaptive confidence gating + confidence thresholding.
2. Neighborhood consensus direction selection.
3. Self-limiting subtraction + selective clutter model updates.

#### P1: SNR accumulation

4. Robust multiping aggregation (median/trimmed).
5. Temporal IIR feedback into data layer.
6. Per-angle outlier rejection history.

#### P2: Resolution upgrades

7. Adaptive quality auto mode.
8. Cross-angle continuity across sweeps.

### Ranked improvement options (impact/feasibility)

1. **Stereo RX + TX/RX combined processing**: partially implemented, needs robust fusion path.
2. **Synthetic aperture (SAFT/DAS)**: baseline implemented, can be tightened with confidence coupling.
3. **Frequency-dependent steering refinement**: not implemented.
4. **Capon/MVDR beamforming**: not implemented.
5. **Beam-pattern deconvolution (CLEAN/RL)**: not implemented.

### Planned file touch points

- `src/scan/scan-engine.ts`: consensus winner + angular continuity.
- `src/scan/heatmap-data.ts`: robust aggregation + temporal IIR.
- `src/scan/ping-cycle.ts`: adaptive confidence and quality auto resolver hooks.
- `src/dsp/clutter.ts`: self-limiting subtraction and selective model update.
- `src/types.ts`, `src/core/store.ts`, `src/ui/controls.ts`: config surface additions.
- `tests/scan/*`, `tests/dsp/*`: regression coverage for gating/consensus/multiping/subtraction.

The app is a browser-based active sonar echolocation system currently implemented as a 2538-line monolithic `index.html`. A partial extraction exists in `src/` (8 JS files, ~1100 lines) but is **not wired into the running app** — the HTML still contains all logic inline. The existing `src/` code also has architectural problems: mutable global `state` singleton, DSP functions coupled to DOM (`el()` calls inside signal processing), and no TypeScript.

This plan refactors into a Vite + TypeScript project and implements all missing features from the research document: FFT-based correlation, GCC-PHAT, multichannel RX with beamforming/DOA, Wasm AudioWorklet DSP, TensorFlow.js ML, WebRTC multi-device sync, and Kalman tracking.

**HTML strategy**: The existing `index.html` has extensive UI markup (controls, canvases, readouts). We keep this markup and remove only the inline `<script>` block. TypeScript modules bind to DOM elements by ID. No UI framework — vanilla TS with typed element refs. New UI for features like WebRTC peer exchange and ML controls will be added as additional HTML sections.

---

## Directory Structure

```
echoscope/
├── index.html                    # HTML with full UI markup (controls, canvases, readouts); TS binds to it
├── vite.config.ts
├── tsconfig.json
├── package.json
├── public/
│   ├── manifest.webmanifest
│   ├── sw.js
│   ├── icon-192.png
│   └── icon-512.png
├── wasm/
│   ├── Cargo.toml                # Rust crate for Wasm DSP
│   ├── src/
│   │   └── lib.rs                # FFT correlation, GCC-PHAT, beamforming kernels
│   └── pkg/                      # wasm-pack output (gitignored, built)
├── src/
│   ├── main.ts                   # Entry: boots app, wires modules
│   ├── types.ts                  # All shared interfaces and type definitions
│   ├── constants.ts              # Device presets, physical constants, defaults
│   │
│   ├── core/
│   │   ├── event-bus.ts          # Typed pub/sub event bus
│   │   └── store.ts              # Reactive state store (replaces global `state`)
│   │
│   ├── audio/
│   │   ├── engine.ts             # AudioContext lifecycle, mic capture, speaker output
│   │   ├── ring-buffer.ts        # Circular sample buffer (typed, testable)
│   │   ├── worklet-tap.ts        # AudioWorklet mic-tap processor (inline blob)
│   │   ├── worklet-dsp.ts        # Wasm-powered AudioWorklet for real-time DSP
│   │   └── latency.ts            # Latency measurement & compensation
│   │
│   ├── signal/
│   │   ├── chirp.ts              # Linear FM chirp generator
│   │   ├── mls.ts                # Maximum Length Sequence generator
│   │   ├── golay.ts              # Golay complementary pair generator
│   │   ├── window.ts             # Window functions (Hann, Blackman-Harris, etc.)
│   │   └── probe-factory.ts      # Unified probe creation from config
│   │
│   ├── dsp/
│   │   ├── correlate.ts          # Time-domain cross-correlation (fallback)
│   │   ├── fft.ts                # FFT/IFFT implementation (radix-2 Cooley-Tukey)
│   │   ├── fft-correlate.ts      # FFT-based correlation O(N log N)
│   │   ├── gcc-phat.ts           # Generalized Cross-Correlation with PHAT weighting
│   │   ├── normalize.ts          # absMax, peak-normalize, dB conversion
│   │   ├── peak.ts               # Peak finding, parabolic interpolation
│   │   ├── profile.ts            # Range profile construction from correlation
│   │   ├── quality.ts            # Profile quality algorithms (median3, triSmooth, floor suppress)
│   │   └── clutter.ts            # Static reflection suppression, env baseline
│   │
│   ├── spatial/
│   │   ├── steering.ts           # TX beam steering (delay-and-sum)
│   │   ├── rx-beamformer.ts      # RX delay-and-sum beamforming (multichannel)
│   │   ├── doa.ts                # Direction-of-arrival estimation (MUSIC, SRP-PHAT)
│   │   └── geometry.ts           # Speaker/mic geometry model, coordinate transforms
│   │
│   ├── calibration/
│   │   ├── engine.ts             # Full calibration procedure (L/R probing, statistics)
│   │   ├── direct-path.ts        # Direct-path tau finder with lock logic
│   │   ├── mono-detect.ts        # Mono output detection heuristic
│   │   ├── quality-score.ts      # Multi-factor calibration quality scoring
│   │   └── env-baseline.ts       # Environmental baseline capture & subtraction
│   │
│   ├── tracking/
│   │   ├── kalman.ts             # Extended Kalman filter for single-target tracking
│   │   ├── multi-target.ts       # Multi-target tracker (track initiation/deletion)
│   │   └── detector.ts           # Peak detector → measurement extractor (CFAR-like)
│   │
│   ├── scan/
│   │   ├── ping-cycle.ts         # Single ping: emit → capture → correlate → profile
│   │   ├── scan-engine.ts        # Full azimuth scan loop with heatmap update
│   │   └── heatmap-data.ts       # Heatmap storage, angle bins, temporal decay
│   │
│   ├── network/
│   │   ├── rtc-transport.ts      # WebRTC DataChannel peer connection manager
│   │   ├── signaling.ts          # Signaling for WebRTC (offer/answer/ICE exchange)
│   │   ├── sync-protocol.ts      # Clock sync protocol (NTP-like round-trip)
│   │   ├── distributed-array.ts  # Merge remote mic data into local processing
│   │   └── codec.ts              # Binary encode/decode for audio chunks + metadata
│   │
│   ├── ml/
│   │   ├── loader.ts             # TensorFlow.js model loading & lifecycle
│   │   ├── multipath-net.ts      # Multipath disentanglement CNN
│   │   ├── rir-estimator.ts      # Room impulse response inference model
│   │   ├── device-adapter.ts     # Cross-device generalization model
│   │   └── features.ts           # Feature extraction for ML inputs
│   │
│   ├── ui/
│   │   ├── app.ts                # Top-level UI controller, wires components to store
│   │   ├── controls.ts           # Control panel: buttons, sliders, selects
│   │   ├── device-presets.ts     # Device preset selector + auto-detection
│   │   ├── geometry-wizard.ts    # Interactive speaker/mic drag-to-position
│   │   └── readouts.ts           # Best-target, direction, status readouts
│   │
│   ├── viz/
│   │   ├── renderer.ts           # Base canvas renderer utilities (DPR, clear, scale)
│   │   ├── profile-plot.ts       # Range profile chart
│   │   ├── heatmap-plot.ts       # Angle x Range heatmap with trace overlay
│   │   ├── geometry-plot.ts      # Geometry top-down view with nodes
│   │   ├── sanity-plot.ts        # Calibration sanity L/R correlation curves
│   │   └── colors.ts             # Color maps, confidence-to-hue, heatmap palette
│   │
│   └── styles/
│       └── main.css              # Extracted from inline <style>
│
└── tests/
    ├── dsp/
    │   ├── correlate.test.ts
    │   ├── fft.test.ts
    │   ├── fft-correlate.test.ts
    │   ├── gcc-phat.test.ts
    │   ├── peak.test.ts
    │   └── profile.test.ts
    ├── signal/
    │   ├── chirp.test.ts
    │   ├── mls.test.ts
    │   └── golay.test.ts
    ├── spatial/
    │   ├── steering.test.ts
    │   ├── rx-beamformer.test.ts
    │   └── doa.test.ts
    ├── tracking/
    │   ├── kalman.test.ts
    │   └── multi-target.test.ts
    ├── calibration/
    │   ├── direct-path.test.ts
    │   └── quality-score.test.ts
    ├── audio/
    │   ├── ring-buffer.test.ts
    │   └── latency.test.ts
    └── network/
        ├── sync-protocol.test.ts
        └── codec.test.ts
```

---

## Key TypeScript Interfaces

Defined in `src/types.ts`:

```typescript
// --- Audio ---
interface AudioConfig {
  sampleRate: number;             // requested (may differ from actual)
  channelCount: number;           // 1 for mono, 2+ for multichannel
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  latencyHint: AudioContextLatencyCategory;
  bufferSeconds: number;          // ring buffer duration
}

interface AudioState {
  context: AudioContext | null;
  actualSampleRate: number;
  channelCount: number;           // actual channels granted
  baseLatency: number;            // seconds
  outputLatency: number;          // seconds
  captureMethod: 'worklet' | 'script-processor';
  isRunning: boolean;
}

// --- Probes ---
type ProbeType = 'chirp' | 'mls' | 'golay';

interface ChirpConfig { f1: number; f2: number; durationMs: number; }
interface MLSConfig { order: number; chipRate: number; }
interface GolayConfig { order: number; chipRate: number; gapMs: number; }
type ProbeConfig =
  | { type: 'chirp'; params: ChirpConfig }
  | { type: 'mls'; params: MLSConfig }
  | { type: 'golay'; params: GolayConfig };

interface ProbeSignal {
  type: ProbeType;
  /** For single probes (chirp/MLS): the reference waveform */
  ref?: Float32Array;
  /** For Golay pairs */
  a?: Float32Array;
  b?: Float32Array;
  gapMs?: number;
}

// --- DSP ---
interface CorrelationResult {
  correlation: Float32Array;      // normalized cross-correlation output
  tau0: number;                   // direct-path delay (seconds)
  method: 'time-domain' | 'fft' | 'gcc-phat';
}

interface RangeProfile {
  bins: Float32Array;             // amplitude per range bin
  minRange: number;               // meters
  maxRange: number;               // meters
  binCount: number;
  bestBin: number;                // index of strongest bin (-1 if none)
  bestRange: number;              // meters (NaN if none)
  bestStrength: number;           // 0..1
}

// --- Spatial ---
interface ArrayGeometry {
  speakers: Array<{ x: number; y: number; z: number }>;
  microphones: Array<{ x: number; y: number; z: number }>;
  spacing: number;                // primary speaker pair spacing (m)
  speedOfSound: number;           // m/s
}

interface SteeringVector {
  angleDeg: number;
  delaysSeconds: Float32Array;    // per-speaker delays
}

interface DOAEstimate {
  azimuthDeg: number;
  elevationDeg: number;           // 0 if 2D only
  confidence: number;             // 0..1
  method: 'scan-peak' | 'music' | 'srp-phat';
}

// --- Calibration ---
interface CalibrationResult {
  valid: boolean;
  quality: number;                // 0..1
  monoLikely: boolean;
  tauMeasured: { L: number; R: number };      // seconds
  tauMAD: { L: number; R: number };           // seconds
  peaks: { L: number; R: number };            // normalized amplitude
  distances: { L: number; R: number };        // meters
  micPosition: { x: number; y: number };      // meters relative to baseline center
  systemDelay: { common: number; L: number; R: number }; // seconds
  geometryError: number;
  envBaseline: Float32Array | null;
  sanity: CalibrationSanity;
}

interface CalibrationSanity {
  curveL: Float32Array;
  curveR: Float32Array;
  peakIndexL: number;
  peakIndexR: number;
  earlyMs: number;
  monoAssessment: MonoAssessment;
}

interface MonoAssessment {
  dt: number;                     // |tauL - tauR| in seconds
  dp: number;                     // |peakL - peakR| normalized
  monoByTime: boolean;            // dt < threshold
  monoByPeak: boolean;            // dp < threshold
  expectDiff: boolean;            // geometry expects distinguishable L/R
  monoLikely: boolean;            // combined verdict
}

// --- Tracking ---
interface TargetState {
  id: number;
  position: { range: number; angleDeg: number };
  velocity: { rangeRate: number; angleRate: number };
  covariance: Float64Array;       // 4x4 flattened
  age: number;                    // frames since creation
  missCount: number;              // consecutive frames without measurement
  confidence: number;
}

interface Measurement {
  range: number;
  angleDeg: number;
  strength: number;
  timestamp: number;
}

// --- Network ---
interface PeerNode {
  id: string;
  connection: RTCPeerConnection;
  dataChannel: RTCDataChannel;
  clockOffset: number;            // seconds, local - remote
  geometry: ArrayGeometry;        // remote device geometry
  lastHeartbeat: number;
}

interface SyncedAudioChunk {
  peerId: string;
  timestamp: number;              // corrected to local clock
  sampleRate: number;
  channels: Float32Array[];       // one per mic channel
  probeConfig: ProbeConfig;       // what probe was active
}

// --- Heatmap ---
interface HeatmapData {
  angles: number[];
  bins: number;
  data: Float32Array;             // angles.length * bins
  display: Float32Array;          // smoothed version for rendering
  bestBin: Int16Array;            // per-angle best bin
  bestVal: Float32Array;          // per-angle best strength
}

// --- Store ---
interface AppState {
  audio: AudioState;
  calibration: CalibrationResult | null;
  geometry: ArrayGeometry;
  heatmap: HeatmapData | null;
  lastProfile: RangeProfile | null;
  lastCorrelation: CorrelationResult | null;
  targets: TargetState[];
  scanning: boolean;
  status: 'idle' | 'initializing' | 'ready' | 'pinging' | 'scanning' | 'calibrating' | 'error';
  peers: Map<string, PeerNode>;
  config: AppConfig;
}

interface AppConfig {
  probe: ProbeConfig;
  steeringAngleDeg: number;
  gain: number;
  listenMs: number;
  minRange: number;
  maxRange: number;
  scanStep: number;
  scanDwell: number;
  strengthGate: number;
  qualityAlgo: 'auto' | 'fast' | 'balanced' | 'max';
  directionAxis: 'horizontal' | 'vertical';
  clutterSuppression: { enabled: boolean; strength: number };
  envBaseline: { enabled: boolean; strength: number; pings: number };
  calibration: { repeats: number; gapMs: number; useCalib: boolean };
  devicePreset: string;
}
```

---

## Module Responsibilities & Data Flow

### Data Flow Diagram

```
User Input (UI controls)
    │
    ▼
┌────────────┐     updates      ┌───────────┐
│  ui/       │ ───────────────► │ core/store │ ◄── network/distributed-array
│  controls  │                  │  (AppState)│
└────────────┘                  └─────┬──────┘
                                      │ events
          ┌───────────────────────────┼──────────────────────┐
          ▼                           ▼                      ▼
   ┌──────────────┐          ┌───────────────┐      ┌──────────────┐
   │ scan/        │          │ calibration/  │      │ viz/         │
   │ scan-engine  │          │ engine        │      │ renderers    │
   └──────┬───────┘          └───────┬───────┘      └──────────────┘
          │                          │
          ▼                          ▼
   ┌──────────────┐          ┌──────────────┐
   │ scan/        │          │ calibration/  │
   │ ping-cycle   │          │ direct-path   │
   └──────┬───────┘          └──────────────┘
          │
    ┌─────┼──────────────┐
    ▼     ▼              ▼
┌───────┐ ┌──────────┐ ┌──────────┐
│signal/│ │ audio/   │ │ dsp/     │
│probes │ │ engine   │ │ fft-corr │
└───────┘ │ (TX+RX)  │ │ gcc-phat │
          └────┬─────┘ └────┬─────┘
               │             │
               ▼             ▼
          ┌──────────┐  ┌──────────┐
          │ audio/   │  │ spatial/ │
          │ worklet  │  │ beamform │
          │ (Wasm)   │  │ + DOA   │
          └──────────┘  └────┬─────┘
                             │
                             ▼
                       ┌───────────┐
                       │ tracking/ │
                       │ kalman    │
                       └───────────┘
```

### Module Contracts

1. **`core/store`** — Single source of truth. Holds `AppState`. Exposes `get()`, `set(path, value)`, `subscribe(path, callback)`. All state mutations go through store. No direct DOM reads for config values — UI writes to store, DSP reads from store.

2. **`core/event-bus`** — Typed events: `'ping:start'`, `'ping:complete'`, `'scan:step'`, `'scan:complete'`, `'calibration:done'`, `'target:updated'`, `'peer:connected'`, `'peer:data'`. Decouples producers from consumers.

3. **`audio/engine`** — Owns AudioContext lifecycle. On init: creates context with requested `sampleRate`, requests getUserMedia with `channelCount`, `echoCancellation:false`, `noiseSuppression:false`, `autoGainControl:false`, `latency` constraint. Creates mic source → worklet chain. Measures and stores `baseLatency + outputLatency`. Exposes `emit(buffer, steeringVector)` and `capture(durationMs): Float32Array[]` (multi-channel).

4. **`audio/ring-buffer`** — Generic typed circular buffer. Constructor takes `(channels: number, lengthSamples: number)`. Methods: `push(channelData: Float32Array[])`, `read(endOffset, length): Float32Array[]`. Zero DOM dependency.

5. **`audio/worklet-dsp`** — AudioWorkletProcessor compiled from Wasm. Receives raw mic samples, runs FFT correlation in real-time, posts correlation results to main thread. Falls back to main-thread JS if Wasm unavailable.

6. **`signal/*`** — Pure functions. Each generator takes `(config, sampleRate) → Float32Array`. No global state access. `probe-factory` dispatches by `ProbeConfig.type`.

7. **`dsp/fft`** — In-place radix-2 Cooley-Tukey FFT/IFFT on Float32Array pairs (real, imag). Supports power-of-2 sizes with zero-padding helper. This is the foundation for `fft-correlate` and `gcc-phat`.

8. **`dsp/fft-correlate`** — `(signal: Float32Array, reference: Float32Array, sr: number) → CorrelationResult`. Computes `IFFT(FFT(signal) * conj(FFT(reference)))`. O(N log N) vs current O(N*M).

9. **`dsp/gcc-phat`** — `(signal1: Float32Array, signal2: Float32Array, sr: number) → { delays: Float32Array, confidence: number }`. Computes cross-spectrum, applies PHAT weighting `W(f) = 1/|G12(f)|`, inverse-transforms. Produces sharper TDOA peaks than plain correlation.

10. **`spatial/rx-beamformer`** — Delay-and-sum on multichannel RX data. `(channels: Float32Array[], geometry: ArrayGeometry, steeringAngle: number, sr: number) → Float32Array`. Aligns channels by computed delays, sums. Requires `channelCount >= 2`.

11. **`spatial/doa`** — Direction-of-arrival. Implements SRP-PHAT: for each candidate angle, compute steered response power using GCC-PHAT across mic pairs. Peak angle = estimated DOA. Optional: MUSIC algorithm for super-resolution when >2 mics.

12. **`calibration/engine`** — Orchestrates full calibration: sends L-only and R-only Golay pings × N repeats, computes median tau, estimates mic geometry, captures env baseline. Returns `CalibrationResult`. No DOM access — reads config from store, writes result to store.

13. **`tracking/kalman`** — Extended Kalman filter. State: `[range, angleDeg, rangeRate, angleRate]`. Prediction with constant-velocity model. Update with range+angle measurements. Outputs `TargetState`.

14. **`tracking/multi-target`** — Manages multiple `TargetState` instances. Measurement-to-track association via nearest-neighbor gating. Track initiation (M-of-N logic) and deletion (miss count threshold).

15. **`network/rtc-transport`** — WebRTC DataChannel manager. Creates peer connections, handles ICE. Sends/receives binary-encoded audio chunks. `connect(signalingData) → PeerNode`, `send(chunk: SyncedAudioChunk)`, `onReceive(callback)`.

16. **`network/sync-protocol`** — NTP-like clock sync over DataChannel. Exchanges timestamped ping/pong messages, computes clock offset via `offset = ((t1-t0) + (t2-t3)) / 2`. Updates `PeerNode.clockOffset`.

17. **`ml/multipath-net`** — TensorFlow.js CNN that takes a range profile + raw correlation as input, outputs a "cleaned" profile with multipath ghosts suppressed. Architecture: 1D Conv layers → ReLU → output same size as input.

18. **`ml/rir-estimator`** — Takes correlation output, outputs estimated Room Impulse Response. Encoder-decoder architecture. Trained offline on simulated RIRs.

19. **`ml/device-adapter`** — Takes device metadata (speaker spacing, mic position, sample rate) + correlation, outputs calibration correction factors. Enables transfer across devices without per-device calibration.

---

## Implementation Phases

### Phase 1: Project Scaffold & Build Setup
- The project already has `package.json` with `vite: "^7.3.1"` and `pnpm-lock.yaml`. Build on this.
- Add `typescript`, `vitest` to devDependencies
- Create `vite.config.ts`, `tsconfig.json`
- **Delete existing `src/*.js` files** (8 files, ~1100 lines) — they are an incomplete, unwired extraction with architectural issues (mutable global state, DOM coupling in DSP). Will be superseded by the typed modules below.
- Extract CSS from `index.html` into `src/styles/main.css`
- Create `src/types.ts` with all interfaces above
- Create `src/constants.ts` with device presets, physical constants
- Create `src/main.ts` entry point
- Refactor `index.html`: keep the full HTML markup (controls, canvases, readouts) but remove the inline `<script>` block; add `<script type="module" src="/src/main.ts"></script>` instead. TS modules bind to existing DOM elements by ID.
- Verify `pnpm dev` starts, `pnpm test` runs

### Phase 2: Core Infrastructure
- **`core/event-bus.ts`** — Typed EventEmitter. `on<K>(event: K, handler)`, `emit<K>(event: K, data)`, `off()`. Uses `Map<string, Set<Function>>`.
- **`core/store.ts`** — Reactive store. Holds `AppState`, notifies subscribers on change. Path-based subscriptions (e.g., `store.subscribe('config.gain', fn)`).
- **`audio/ring-buffer.ts`** — Pure data structure, fully testable. Supports multichannel.
- **`src/utils.ts`** — `clamp`, `sleep`, `median`, `mad`.
- Tests for ring-buffer, event-bus, store, utils.

### Phase 3: Signal Generation (port existing)
- **`signal/window.ts`** — Hann, Blackman-Harris window functions.
- **`signal/chirp.ts`** — Port `genChirp()`. Pure function: `(config: ChirpConfig, sr: number) → Float32Array`.
- **`signal/mls.ts`** — Port `genMLS()`, `genMLSChipped()`. Pure functions.
- **`signal/golay.ts`** — Port `genGolayPair()`, `genGolayChipped()`. Pure functions.
- **`signal/probe-factory.ts`** — `createProbe(config: ProbeConfig, sr: number): ProbeSignal`.
- Tests verifying output lengths, known properties (Golay autocorrelation sum = delta, MLS period).

### Phase 4: DSP Core (port + upgrade)
- **`dsp/correlate.ts`** — Port time-domain `correlate()` as fallback. Pure function.
- **`dsp/normalize.ts`** — Port `absMaxNormalize()`.
- **`dsp/peak.ts`** — Port `findPeak()`, `findPeakAbs()`, `estimateBestFromProfile()` with parabolic interpolation. Pure functions taking `sampleRate` as parameter instead of reading global.
- **`dsp/fft.ts`** — **NEW**. Implement radix-2 Cooley-Tukey in-place FFT. Functions: `fft(real, imag)`, `ifft(real, imag)`, `nextPow2(n)`, `zeroPad(signal, targetLength)`. In-place to minimize allocations.
- **`dsp/fft-correlate.ts`** — **NEW**. `fftCorrelate(x, s, sr): CorrelationResult`. Zero-pads both to next power of 2, FFT both, multiply X * conj(S), IFFT, extract valid region.
- **`dsp/gcc-phat.ts`** — **NEW**. `gccPhat(sig1, sig2, sr): { gcc: Float32Array, peakDelay: number, confidence: number }`. Cross-power spectrum with phase normalization.
- **`dsp/profile.ts`** — Port `buildRangeProfileFromCorrelation()`. Pure function taking explicit `sampleRate`, `heatBins` parameters.
- **`dsp/quality.ts`** — Port `median3Profile`, `triSmoothProfile`, `adaptiveFloorSuppressProfile`. Pure functions.
- **`dsp/clutter.ts`** — Port `suppressStaticReflectionsInProfile`, `applyEnvBaselineToProfile`. Takes clutter state as parameter, returns new state (functional, not mutating global).
- Tests: verify FFT against known DFT results, verify FFT-correlate matches time-domain correlate, verify GCC-PHAT peak location for known delay.

### Phase 5: Audio Engine (port + multichannel)
- **`audio/engine.ts`** — Port `initAudio()`. Key changes:
  - Request `channelCount` from store config (default 1, support 2+).
  - Add `sampleRate` constraint to getUserMedia.
  - Add `latency: { ideal: 0.01 }` constraint.
  - Measure and store `baseLatency`, `outputLatency` in store.
  - Create worklet from blob URL (port existing pattern).
  - Fallback to ScriptProcessor if worklet fails.
  - Expose `emitSteered(probe, steeringVector, gain)` and `getCapture(durationMs, channelCount): Float32Array[]`.
- **`audio/worklet-tap.ts`** — Port existing `MicTapProcessor`. Extended to forward all channels (not just channel 0).
- **`audio/latency.ts`** — **NEW**. `compensateLatency(capturedSamples, baseLatency, outputLatency, sr): { adjusted: Float32Array, totalLatencyMs: number }`. Trims or shifts capture window by measured round-trip system latency. Used by ping-cycle to correct tau0.
- **`spatial/steering.ts`** — Port `buildSteeredStereoPing`, `buildStereoPingCustom`. Generalized to N speakers.
- Tests for ring-buffer multichannel, latency compensation math.

### Phase 6: Calibration Engine (port)
- **`calibration/direct-path.ts`** — Port `findDirectPathTau()`. Pure function: `(corr, predictedTau0, lockStrength, sr) → number`.
- **`calibration/mono-detect.ts`** — Port `assessMonoDecision()`. Pure function.
- **`calibration/quality-score.ts`** — Port `computeCalibQuality()`. Pure function.
- **`calibration/env-baseline.ts`** — Port env baseline capture logic. Returns `Float32Array`.
- **`calibration/engine.ts`** — Port `calibrateRefinedWithSanity()`. Reads config from store, uses audio engine to emit/capture, uses DSP modules for correlation, writes `CalibrationResult` to store. No DOM access.
- Tests for direct-path finder, quality scoring with known inputs.

### Phase 7: Scan & Ping Cycle (port)
- **`scan/ping-cycle.ts`** — Port `doPing()`. Orchestrates: read config from store → create probe → compute steering delay → emit via audio engine → capture → correlate (using FFT-correlate by default, fallback to time-domain) → build profile → apply quality algorithms → apply clutter suppression → find best → update store.
- **`scan/scan-engine.ts`** — Port `doScan()`. Iterates angles, calls ping-cycle per step, updates heatmap data in store, emits events.
- **`scan/heatmap-data.ts`** — Port `resetHeat()`, heatmap update logic. Pure data operations on `HeatmapData`.

### Phase 8: UI & Visualization (port)
- **`ui/app.ts`** — Top-level controller. Subscribes to store, dispatches to renderers and controls. Wires button click → scan-engine, etc.
- **`ui/controls.ts`** — Reads DOM inputs, writes to `store.config`. Replaces all `el("xxx").value` reads scattered through DSP code.
- **`ui/device-presets.ts`** — Port device detection logic and preset application.
- **`ui/geometry-wizard.ts`** — Port geometry wizard (drag handles on canvas). Reads/writes store geometry.
- **`ui/readouts.ts`** — Port direction/best readout updates.
- **`viz/renderer.ts`** — Port `canvasPixelScale`, `resizeCanvasForDPR`, `clearCanvas`.
- **`viz/profile-plot.ts`** — Port `drawProfile`. Receives data from store, no state access.
- **`viz/heatmap-plot.ts`** — Port `drawHeatmap`. Receives `HeatmapData` from store.
- **`viz/geometry-plot.ts`** — Port `drawGeometry`. Receives geometry + target state.
- **`viz/sanity-plot.ts`** — Port `drawCalibSanityPlot`.
- **`viz/colors.ts`** — Port `traceColorFromConfidence` and heatmap color mapping.

### Phase 9: Spatial Processing (new)
- **`spatial/rx-beamformer.ts`** — Delay-and-sum beamformer for multichannel RX. `(channels: Float32Array[], steeringAngle: number, geometry: ArrayGeometry, sr: number) → Float32Array`. Computes per-mic delay from geometry + angle, shifts and sums.
- **`spatial/doa.ts`** — SRP-PHAT direction-of-arrival. Sweeps candidate angles, computes steered response power using `gcc-phat` across all mic pairs, returns angle with maximum power. Falls back to scan-peak method when only 1 mic.
- **`spatial/geometry.ts`** — Port `estimateMicXY()`. Add functions for N-element array geometry computation.
- Integrate RX beamformer into ping-cycle: after capture, if multichannel, beamform before correlation.
- Integrate DOA into scan: after scan, run DOA on multichannel data for independent angle estimate.
- Tests with synthetic multichannel data (known delays → verify recovered angle).

### Phase 10: Wasm AudioWorklet DSP (new)
- **`wasm/src/lib.rs`** — Rust crate compiled to Wasm via wasm-pack. Implements:
  - `fft_correlate(signal_ptr, signal_len, ref_ptr, ref_len) → correlation_ptr` — FFT correlation kernel.
  - `gcc_phat(sig1_ptr, sig1_len, sig2_ptr, sig2_len) → result_ptr` — GCC-PHAT kernel.
  - `delay_and_sum(channels_ptr, n_channels, n_samples, delays_ptr) → output_ptr` — RX beamforming kernel.
  - Uses `rustfft` crate for FFT.
- **`audio/worklet-dsp.ts`** — AudioWorkletProcessor that loads Wasm module. Receives mic samples in `process()`, runs correlation in Wasm, posts results via `port.postMessage`. Main thread receives correlation results instead of raw samples (reduces message overhead).
- Feature-detect Wasm support in AudioWorklet. If unavailable, fall back to main-thread TypeScript DSP (Phase 4 modules).
- Build integration: `vite.config.ts` plugin to run `wasm-pack build` and import `.wasm` as asset.

### Phase 11: Kalman Tracking (new)
- **`tracking/kalman.ts`** — Extended Kalman filter:
  - State vector: `[range, angleDeg, rangeRate, angleRate]`
  - Prediction: constant-velocity model with configurable process noise
  - Update: range + angle measurement with measurement noise covariance
  - Outputs `TargetState` with position, velocity, covariance, confidence
- **`tracking/detector.ts`** — Extract measurements from range profile: find all peaks above threshold, report as `Measurement[]`. Uses CFAR-like adaptive threshold.
- **`tracking/multi-target.ts`** — Multi-target tracker:
  - Measurement-to-track association via gated nearest neighbor (Mahalanobis distance)
  - Track initiation: M-of-N logic (e.g., 3 detections in 5 scans)
  - Track deletion: miss count > threshold (e.g., 10 consecutive misses)
  - Maintains `TargetState[]` in store
- Integrate into scan-engine: after each scan sweep, run detector → multi-target update → store targets.
- UI: visualize tracked targets on geometry plot (with velocity vectors).
- Tests with synthetic measurement sequences.

### Phase 12: WebRTC Multi-Device (new)
- **`network/signaling.ts`** — Manual signaling: device A generates offer (displayed as QR code or copyable text), device B pastes it and generates answer. No server needed for local usage. Optional: WebSocket signaling server for convenience.
- **`network/rtc-transport.ts`** — Manages RTCPeerConnection + RTCDataChannel. `connect(remoteDescription)`, `disconnect()`, `send(data: ArrayBuffer)`, `onMessage(callback)`. Handles ICE candidates, connection state.
- **`network/codec.ts`** — Binary protocol for audio chunks:
  ```
  [header: 4 bytes magic][timestamp: float64][sampleRate: uint32]
  [channelCount: uint8][samplesPerChannel: uint32][...float32 samples]
  ```
- **`network/sync-protocol.ts`** — Clock synchronization:
  - Send ping with local timestamp t0
  - Remote echoes with t0, t1 (remote receive), t2 (remote send)
  - Local records t3 (receive time)
  - Offset = ((t1-t0) + (t2-t3)) / 2
  - Runs periodically (every 5s), EWMA smoothing on offset
- **`network/distributed-array.ts`** — Merges remote audio into local processing:
  - Receives `SyncedAudioChunk` from peers
  - Adjusts timestamps using clock offset
  - Resamples if sample rates differ (linear interpolation)
  - Extends local multichannel array with remote channels
  - Passes merged multichannel data to RX beamformer / DOA
- UI: "Connect Device" button, signaling exchange UI, peer status display.

### Phase 13: TensorFlow.js ML (new)
- **`ml/loader.ts`** — Model lifecycle: `loadModel(url): tf.LayersModel`, `warmup(model)`, `dispose(model)`. Handles WebGL/Wasm backend selection.
- **`ml/features.ts`** — Feature extraction: takes correlation + range profile, outputs tensor. Normalization, windowing, optional spectrogram features.
- **`ml/multipath-net.ts`** — Multipath suppression:
  - Input: range profile (240 bins) + raw correlation (variable, padded)
  - Architecture: 1D Conv(32, k=5) → ReLU → Conv(32, k=5) → ReLU → Conv(1, k=1) → Sigmoid
  - Output: cleaned profile (same size), values 0..1 representing "real echo" probability
  - Ships with pre-trained weights (trained on simulated data)
  - Integrates into ping-cycle as optional post-processing step
- **`ml/rir-estimator.ts`** — Room Impulse Response inference:
  - Input: correlation output
  - Architecture: 1D encoder-decoder (U-Net style)
  - Output: estimated RIR (for room characterization display)
  - Optional feature — displayed in a new "Room" visualization panel
- **`ml/device-adapter.ts`** — Cross-device calibration transfer:
  - Input: device metadata (spacing, mic position) + correlation from unknown device
  - Output: correction factors for tau0, gain balance
  - Reduces need for per-device calibration
  - Uses small FC network
- Model training scripts (Python, separate repo/directory) — out of scope for this plan but documented as future work.
- Tests: model loads, inference produces correct output shape, feature extraction is deterministic.

### Phase 14: PWA & Polish
- Update `sw.js` with working cache strategy for the built assets
- Update `manifest.webmanifest`
- Add `vite-plugin-pwa` for automatic SW generation
- Responsive CSS refinement
- Keyboard shortcuts for common actions
- Performance profiling and optimization

---

## Dependencies

```json
{
  "devDependencies": {
    "vite": "^7.x",
    "typescript": "^5.x",
    "vitest": "^3.x",
    "vite-plugin-pwa": "^1.x"
  },
  "dependencies": {
    "@tensorflow/tfjs": "^4.x"
  }
}
```

Wasm toolchain (installed separately): `rustup`, `wasm-pack`.

---

## Verification Plan

After each phase, verify:

1. **Phase 1-2**: `pnpm dev` starts, `pnpm test` runs (even if no app logic yet)
2. **Phase 3**: `pnpm test` passes signal generation tests. Verify chirp/MLS/Golay output matches current app output by comparing Float32Array values.
3. **Phase 4**: FFT correlation produces same peak locations as time-domain. GCC-PHAT produces sharper peaks. All DSP tests pass.
4. **Phase 5**: Audio initializes, mic capture works, multichannel requested (may still get mono depending on hardware). Ring buffer captures samples.
5. **Phase 6**: Calibration produces same quality scores as current app for same input conditions.
6. **Phase 7-8**: Full app functional in browser — ping, scan, heatmap, geometry view all work. Visual output matches current monolith.
7. **Phase 9**: With stereo mic (if available), RX beamformer improves SNR vs mono. DOA angle matches TX scan angle.
8. **Phase 10**: Wasm worklet runs FFT correlation. Measure latency improvement vs main-thread JS.
9. **Phase 11**: Tracked targets persist across scans, velocity vectors shown. No spurious tracks with no target.
10. **Phase 12**: Two devices connect via WebRTC, exchange audio, merged beamforming produces result.
11. **Phase 13**: ML models load, multipath net reduces ghost peaks in synthetic test data.
12. **Phase 14**: PWA installs, works offline, caches assets correctly.

End-to-end test: Run the app on a MacBook, calibrate, scan a room, verify heatmap shows wall echoes at plausible distances and angles.
