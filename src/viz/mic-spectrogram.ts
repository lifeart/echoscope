import { bus } from '../core/event-bus.js';
import { store } from '../core/store.js';
import { clamp } from '../utils.js';
import { fft } from '../dsp/fft.js';
import { getColormapLUT } from './colors.js';

let initialized = false;
let lastRenderMs = 0;
let isEnabled = true;
let fftSize = 512;
let hopSize = 128;
let minDb = -90;
let maxDb = -20;
let targetFps = 24;

let ring = new Float32Array(4096);
let ringSize = ring.length;
let ringWrite = 0;
let totalSamplesSeen = 0;
let samplesSinceLastFrame = 0;

let window = new Float32Array(fftSize);
let real = new Float32Array(fftSize);
let imag = new Float32Array(fftSize);
let latestSpectrumDb = new Float32Array(fftSize >> 1);
let framePending = false;
let spectralFloor = new Float32Array(0);
let spectralFloorVar = new Float32Array(0);
let lastFilteringActive = false;
let modeLabel: 'off' | 'raw' | 'filtered' = 'raw';

let rafId = 0;

const infernoLut = getColormapLUT('inferno');

function setModeLabel(next: 'off' | 'raw' | 'filtered'): void {
  if (modeLabel === next) return;
  modeLabel = next;
  const node = document.getElementById('micSpectrogramMode');
  if (!node) return;
  if (next === 'off') {
    node.textContent = 'Mode: OFF';
  } else if (next === 'filtered') {
    node.textContent = 'Mode: FILTERED';
  } else {
    node.textContent = 'Mode: RAW';
  }
}

function nearestPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function sanitizeFftSize(v: number): number {
  const bounded = clamp(Math.floor(v), 128, 2048);
  return nearestPow2(bounded);
}

function rebuildBuffers(): void {
  window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, fftSize - 1));
  }

  real = new Float32Array(fftSize);
  imag = new Float32Array(fftSize);
  latestSpectrumDb = new Float32Array(fftSize >> 1);

  ringSize = Math.max(4096, fftSize * 8);
  ring = new Float32Array(ringSize);
  ringWrite = 0;
  totalSamplesSeen = 0;
  samplesSinceLastFrame = 0;
  framePending = false;
  spectralFloor = new Float32Array(fftSize >> 1);
  spectralFloorVar = new Float32Array(fftSize >> 1);
  for (let i = 0; i < spectralFloorVar.length; i++) spectralFloorVar[i] = 1;
  lastFilteringActive = false;
}

function clearCanvas(): void {
  const canvas = document.getElementById('micSpectrogram') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function readConfig(force = false): void {
  const cfg = store.get().config.spectrogram;
  const nextEnabled = cfg.enabled;
  const nextFft = sanitizeFftSize(cfg.fftSize);
  const nextHop = Math.max(1, Math.min(nextFft, Math.floor(cfg.hopSize)));
  const nextMinDb = Math.min(cfg.minDb, cfg.maxDb - 1);
  const nextMaxDb = Math.max(cfg.maxDb, cfg.minDb + 1);
  const nextFps = clamp(Math.floor(cfg.fps), 5, 60);

  const changed = force
    || nextFft !== fftSize
    || nextHop !== hopSize
    || nextMinDb !== minDb
    || nextMaxDb !== maxDb
    || nextFps !== targetFps
    || nextEnabled !== isEnabled;

  if (!changed) return;

  isEnabled = nextEnabled;
  fftSize = nextFft;
  hopSize = nextHop;
  minDb = nextMinDb;
  maxDb = nextMaxDb;
  targetFps = nextFps;

  const details = document.getElementById('micSpectrogramDetails');
  if (details) details.style.display = isEnabled ? '' : 'none';
  setModeLabel(isEnabled ? 'raw' : 'off');

  rebuildBuffers();
  clearCanvas();
}

function pushSamples(samples: Float32Array): void {
  for (let i = 0; i < samples.length; i++) {
    ring[ringWrite] = samples[i];
    ringWrite = (ringWrite + 1) % ringSize;
  }
  totalSamplesSeen += samples.length;
  samplesSinceLastFrame += samples.length;
}

function copyLatestFrameToFftInput(): void {
  const start = ringWrite - fftSize;
  for (let i = 0; i < fftSize; i++) {
    const idx = (start + i + ringSize) % ringSize;
    real[i] = ring[idx] * window[i];
    imag[i] = 0;
  }
}

function computeLatestSpectrum(): void {
  copyLatestFrameToFftInput();
  fft(real, imag);

  const state = store.get();
  const filteringActive = !!state.calibration?.valid && state.config.noiseKalman.enabled;
  setModeLabel(filteringActive ? 'filtered' : 'raw');
  const noiseCfg = state.config.noiseKalman;
  if (filteringActive !== lastFilteringActive) {
    for (let i = 0; i < spectralFloor.length; i++) {
      spectralFloor[i] = 0;
      spectralFloorVar[i] = 1;
    }
    lastFilteringActive = filteringActive;
  }

  const bins = latestSpectrumDb.length;
  for (let k = 0; k < bins; k++) {
    const rr = real[k];
    const ii = imag[k];
    const power = rr * rr + ii * ii + 1e-12;

    let displayPower = power;
    if (filteringActive && k < spectralFloor.length) {
      const q = Math.max(0, noiseCfg.processNoiseQ);
      const r = Math.max(1e-12, noiseCfg.measurementNoiseR);
      spectralFloorVar[k] += q;

      const prevFloor = spectralFloor[k];
      const robustMeasurement = prevFloor > 1e-12 ? Math.min(power, prevFloor * 1.8) : power;
      const kalmanGain = spectralFloorVar[k] / (spectralFloorVar[k] + r);
      const updatedFloor = prevFloor + kalmanGain * (robustMeasurement - prevFloor);

      spectralFloor[k] = Math.max(0, updatedFloor);
      spectralFloorVar[k] = Math.max(1e-12, (1 - kalmanGain) * spectralFloorVar[k]);

      displayPower = Math.max(1e-12, power - Math.max(0, noiseCfg.subtractStrength) * spectralFloor[k]);
    }

    latestSpectrumDb[k] = 10 * Math.log10(displayPower);
  }
}

function drawLatestColumn(): void {
  const canvas = document.getElementById('micSpectrogram') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  if (w < 2 || h < 2) return;

  ctx.drawImage(canvas, -1, 0);

  const image = ctx.createImageData(1, h);
  const data = image.data;
  const bins = latestSpectrumDb.length;
  const dbRange = Math.max(1e-6, maxDb - minDb);

  for (let y = 0; y < h; y++) {
    const binPos = ((h - 1 - y) / Math.max(1, h - 1)) * (bins - 1);
    const bin = clamp(Math.round(binPos), 0, bins - 1);
    const db = latestSpectrumDb[bin];
    const norm = clamp((db - minDb) / dbRange, 0, 1);
    const lutIdx = Math.floor(norm * 255) * 3;

    const px = y * 4;
    data[px] = infernoLut[lutIdx];
    data[px + 1] = infernoLut[lutIdx + 1];
    data[px + 2] = infernoLut[lutIdx + 2];
    data[px + 3] = 255;
  }

  ctx.putImageData(image, w - 1, 0);
}

function onSamples(samples: Float32Array): void {
  readConfig();
  if (!isEnabled) return;

  pushSamples(samples);
  if (totalSamplesSeen < fftSize) return;

  while (samplesSinceLastFrame >= hopSize) {
    samplesSinceLastFrame -= hopSize;
    computeLatestSpectrum();
    framePending = true;
  }
}

function startRenderLoop(): void {
  if (rafId) return;
  function renderLoop(ts: number): void {
    rafId = requestAnimationFrame(renderLoop);
    if (!isEnabled || !framePending) return;

    const minInterval = 1000 / Math.max(1, targetFps);
    if (ts - lastRenderMs < minInterval) return;

    lastRenderMs = ts;
    framePending = false;
    drawLatestColumn();
  }
  rafId = requestAnimationFrame(renderLoop);
}

function stopRenderLoop(): void {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

export function initMicSpectrogram(): void {
  if (initialized) return;
  initialized = true;

  readConfig(true);
  bus.on('audio:samples', onSamples);

  const detailsEl = document.getElementById('micSpectrogramDetails') as HTMLDetailsElement | null;
  if (detailsEl && typeof detailsEl.addEventListener === 'function') {
    detailsEl.addEventListener('toggle', () => {
      if (detailsEl.open) startRenderLoop();
      else stopRenderLoop();
    });
    // Start the loop only if the details element is already open
    if (detailsEl.open) {
      startRenderLoop();
    }
  } else {
    // No details element found or not a real HTMLDetailsElement — always run
    startRenderLoop();
  }
}
