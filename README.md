# Echoscope

Browser-based active sonar echolocation system. Transmits acoustic signals through device speakers, captures microphone echoes, and uses matched-filter cross-correlation to estimate target range and direction in real time.

Runs entirely in the browser using the Web Audio API — no server or native code required.

## Quick Start

```bash
pnpm install
pnpm dev
```

Open the app in your browser (HTTPS or localhost required for microphone access), click **Init Audio** to grant mic permissions, then use **Ping** for a single measurement or **Scan** to sweep angles and build a 2D heatmap.

## How It Works

1. **Transmit** a probe signal (chirp, MLS, Golay pair, or multiplexed carriers) from the device speakers
2. **Capture** the microphone recording containing direct path + reflected echoes
3. **Correlate** the recording against the reference signal using FFT cross-correlation
4. **Extract** range profile peaks — distance to reflecting surfaces/objects
5. **Steer** TX/RX beamforming across angles to build a 2D angle-vs-range heatmap
6. **Track** detected targets over time with Kalman filtering

## Signal Types

| Signal | Method | Strengths |
|--------|--------|-----------|
| **Chirp** | Linear FM sweep (f1 → f2) with Hann window | Lowest latency, simple |
| **MLS** | Maximum-length LFSR pseudo-random sequence | Flat autocorrelation sidelobes |
| **Golay** | Complementary pair (A + B) | Zero-sidelobe sum, best multipath rejection |
| **Multiplex** | Multi-carrier FDM/OFDM | Parallel frequency-division ranging |

## Calibration

Before scanning, run the built-in calibration to:

- Measure speaker-to-microphone system delay (direct path)
- Detect mono vs. stereo microphone configuration
- Capture environmental baseline for clutter subtraction
- Qualify best carriers (multiplex mode)

Calibration uses Golay pairs across multiple frequency bands to account for frequency-dependent room acoustics.

## Noise Stabilization & Mic Spectrogram

- **Microphone spectrogram**: real-time STFT waterfall view of incoming mic audio (configurable FFT/hop/dB range/FPS).
- **Noise-floor Kalman (per-bin)**: adaptive background floor estimation with optional freeze on high-confidence detections.
- **Pipeline order (scan)**: env baseline subtraction → noise-floor Kalman subtraction → static clutter suppression → confidence/CFAR gating.
- **Calibration baseline modes**: keeps both raw and Kalman-filtered baseline variants, with feature flags for safe rollout.

## Device Support

Built-in geometry presets for:

- MacBook Pro 14" / 16"
- MacBook Air 13" / 15"
- iPhone (portrait)
- iPad Pro 11" / 13"

Speaker and microphone positions can be manually adjusted via the geometry wizard.

## Project Structure

```
src/
  audio/        # Web Audio API engine, AudioWorklet, ring buffer
  signal/       # Probe signal generation (chirp, MLS, Golay, multiplex)
  dsp/          # FFT correlation, GCC-PHAT, bandpass, CFAR, clutter suppression
  scan/         # Scan engine, ping cycle, heatmap accumulation, SAFT
  calibration/  # Multi-band calibration pipeline
  spatial/      # TX steering, RX beamforming, DOA estimation
  tracking/     # Kalman filter, multi-target association
  ml/           # Optional TF.js multipath/RIR estimation
  network/      # Optional WebRTC distributed array sync
  viz/          # Canvas plotting (profile, heatmap, geometry, level meter)
  ui/           # Controls, device presets, readouts
  core/         # Reactive store, event bus
```

## Scripts

```bash
pnpm dev          # Start Vite dev server with hot reload
pnpm build        # Type-check + production build
pnpm preview      # Preview production build
pnpm test         # Run test suite
pnpm test:watch   # Run tests in watch mode
```

## Tech Stack

- **TypeScript** (strict mode) — no UI framework, vanilla DOM + Canvas 2D
- **Vite** — build and dev server
- **Web Audio API** — audio capture and playback via AudioWorklet
- **Vitest** — test suite
- **PWA** — offline-capable via vite-plugin-pwa

## License

ISC
