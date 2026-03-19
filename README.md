# Echoscope

**Browser-based active sonar echolocation system.**

Transmits acoustic probe signals through device speakers, captures microphone echoes, and uses matched-filter cross-correlation to estimate target range and direction in real time. Runs entirely in the browser -- no server, no native code, no dependencies beyond the Web Audio API.

[![Deploy to GitHub Pages](https://github.com/lifeart/echoscope/actions/workflows/deploy.yml/badge.svg)](https://github.com/lifeart/echoscope/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/lifeart/echoscope/blob/main/LICENSE)

**[Live Demo](https://lifeart.github.io/echoscope/)**

---

## Features

- **Multiple signal types** -- chirp, MLS, Golay, and multiplexed FDM/OFDM carriers
- **Real-time range profiling** -- FFT cross-correlation with sub-sample accuracy
- **2D heatmap** -- angle-vs-range display built from steered ping sweeps
- **Kalman tracking** -- multi-target state estimation with association logic
- **Multi-band calibration** -- Golay-based system delay, mic geometry, and environmental baseline measurement
- **Beamforming** -- TX steering and RX delay-and-sum with GCC-PHAT TDOA
- **CFAR detection** -- constant false alarm rate gating with noise-floor Kalman filtering
- **Device presets** -- built-in speaker/mic geometry for MacBook, iMac, iPhone, and iPad models
- **Geometry wizard** -- manual speaker and microphone position editing with visual feedback
- **Mic spectrogram** -- real-time STFT waterfall view of incoming audio
- **WebRTC distributed array** -- optional multi-device synchronization over peer connections
- **PWA** -- installable, works offline via service worker
- **Keyboard shortcuts** -- `I` init, `P`/`Space` ping, `S` scan, `Esc` stop, `C` calibrate

## Quick Start

```bash
pnpm install
pnpm dev
```

Open the app in your browser (HTTPS or localhost required for microphone access), click **Init Audio** to grant mic permissions, then use **Ping** for a single measurement or **Scan** to sweep angles and build a 2D heatmap.

## How It Works

1. **Generate** a probe signal (chirp, MLS, Golay pair, or multiplexed carriers)
2. **Transmit** the signal through the device speakers via Web Audio API
3. **Capture** the microphone recording containing direct path plus reflected echoes
4. **Correlate** the recording against the reference signal using FFT cross-correlation
5. **Extract** range profile peaks corresponding to reflecting surfaces and objects
6. **Steer** TX/RX beamforming across angles to build a 2D angle-vs-range heatmap
7. **Track** detected targets over time with Kalman filtering and multi-target association

The entire pipeline runs client-side in the browser. Audio I/O uses an AudioWorklet for low-latency, glitch-free capture. DSP is performed in the main thread using typed arrays and an in-place FFT.

## Signal Types

| Signal        | Method                                    | Strengths                                     |
| ------------- | ----------------------------------------- | --------------------------------------------- |
| **Chirp**     | Linear FM sweep (f1 to f2) with Hann window | Lowest latency, simple, good time resolution  |
| **MLS**       | Maximum-length LFSR pseudo-random sequence   | Flat autocorrelation sidelobes                |
| **Golay**     | Complementary pair (A + B)                   | Zero-sidelobe sum, best multipath rejection   |
| **Multiplex** | Multi-carrier FDM/OFDM                       | Parallel frequency-division ranging           |

## Device Support

Built-in geometry presets automatically configure speaker and microphone positions for:

- MacBook Pro 14" / 16"
- MacBook Air 13" / 15"
- iMac 24"
- iPhone (portrait)
- iPad Pro 11" / 13"
- iPad Air 11" / 13"
- iPad mini
- Custom (manual configuration)

The app auto-detects your device on load. Positions can be adjusted manually via the geometry wizard or by selecting the **Custom** preset.

## Calibration

Before scanning, run the built-in calibration to:

- Measure speaker-to-microphone system delay (direct path)
- Detect mono vs. stereo microphone configuration
- Capture environmental baseline for clutter subtraction
- Qualify best carriers (multiplex mode)

Calibration transmits Golay pairs across multiple frequency bands to account for frequency-dependent room acoustics. Results are stored and applied automatically to subsequent scans.

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
pnpm test         # Run test suite (~200 tests across ~30 files)
pnpm test:watch   # Run tests in watch mode
```

## Tech Stack

- **TypeScript** (strict mode) -- vanilla DOM, no UI framework
- **Vite** -- build tooling and dev server
- **Web Audio API** -- audio capture and playback via AudioWorklet
- **Canvas 2D** -- all visualization (heatmap, range profile, geometry, spectrogram)
- **Vitest** -- test runner
- **vite-plugin-pwa** -- service worker generation and offline support

## Contributing

Contributions are welcome. To get started:

1. Fork the repository
2. Create a feature branch (`git checkout -b my-feature`)
3. Run `pnpm test` to make sure all tests pass
4. Submit a pull request

Please keep changes focused and include tests for new DSP or signal processing logic.

## License

[MIT](./LICENSE)
