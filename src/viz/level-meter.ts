import { bus } from '../core/event-bus.js';
import { resizeCanvasForDPR } from './renderer.js';

let smoothedRms = 0;
let rafPending = false;
let initialized = false;
let cachedGradient: CanvasGradient | null = null;

export function initLevelMeter(): void {
  if (initialized) return;
  initialized = true;

  const wrap = document.getElementById('levelMeterWrap');
  if (wrap) wrap.style.display = 'flex';

  const canvas = document.getElementById('levelMeter') as HTMLCanvasElement | null;
  if (canvas) {
    resizeCanvasForDPR(canvas);
    cachedGradient = null; // invalidate gradient after resize
  }

  bus.on('audio:samples', onSamples);
}

function onSamples(samples: Float32Array): void {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  smoothedRms = smoothedRms * 0.85 + rms * 0.15;
  if (!rafPending) {
    rafPending = true;
    requestAnimationFrame(drawMeter);
  }
}

function drawMeter(): void {
  rafPending = false;
  const canvas = document.getElementById('levelMeter') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const db = smoothedRms > 1e-10 ? 20 * Math.log10(smoothedRms) : -60;
  const clamped = Math.max(-60, Math.min(0, db));
  const frac = (clamped + 60) / 60; // 0..1

  if (!cachedGradient) {
    cachedGradient = ctx.createLinearGradient(0, 0, w, 0);
    cachedGradient.addColorStop(0, '#4caf50');
    cachedGradient.addColorStop(0.6, '#ffeb3b');
    cachedGradient.addColorStop(0.85, '#ff9800');
    cachedGradient.addColorStop(1, '#f44336');
  }
  ctx.fillStyle = cachedGradient;
  ctx.fillRect(0, 0, w * frac, h);

  const dbEl = document.getElementById('levelDb');
  if (dbEl) dbEl.textContent = `${clamped.toFixed(0)} dB`;
}
