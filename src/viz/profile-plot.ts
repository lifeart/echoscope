import { store } from '../core/store.js';
import { clearCanvas, getCanvasCtx } from './renderer.js';

export function drawProfile(
  corr: Float32Array,
  tau0: number,
  c: number,
  minR: number,
  maxR: number,
): void {
  const r = getCanvasCtx('profile');
  if (!r) return;
  const { ctx, w, h, s } = r;
  const sr = store.get().audio.actualSampleRate;

  const xPad = 50 * s;
  const yTop = 10 * s;
  const yBottom = h - 30 * s;
  const xSpan = w - 70 * s;
  const ySpan = h - 50 * s;
  const xRight = w - 10 * s;
  clearCanvas(ctx, w, h);

  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  ctx.moveTo(xPad, yTop);
  ctx.lineTo(xPad, yBottom);
  ctx.lineTo(xRight, yBottom);
  ctx.stroke();

  const minTau = (2 * minR) / c;
  const maxTau = (2 * maxR) / c;

  // Find max absolute value for auto-scaling
  let absMax = 0;
  for (let i = 0; i < corr.length; i++) {
    const tau = (i / sr) - tau0;
    if (tau < minTau || tau > maxTau) continue;
    const v = Math.abs(corr[i]);
    if (v > absMax) absMax = v;
  }
  if (absMax < 1e-12) absMax = 1;
  const scale = 1 / absMax;

  ctx.strokeStyle = '#8dd0ff';
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  let started = false;

  for (let i = 0; i < corr.length; i++) {
    const tau = (i / sr) - tau0;
    if (tau < minTau || tau > maxTau) continue;
    const R = (c * tau) / 2;
    const x = xPad + (R - minR) / (maxR - minR) * xSpan;
    const y = yBottom - ((corr[i] * scale * 0.5 + 0.5) * ySpan);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.fillStyle = '#bdbdbd';
  ctx.font = `${12 * s}px system-ui`;
  ctx.fillText(`Range profile (calibrated). minR=${minR}m maxR=${maxR}m`, 54 * s, 22 * s);
}

export function drawProfilePlaceholder(): void {
  const r = getCanvasCtx('profile');
  if (!r) return;
  const { ctx, w, h, s } = r;
  clearCanvas(ctx, w, h);
  ctx.fillStyle = '#bdbdbd';
  ctx.font = `${12 * s}px system-ui`;
  ctx.fillText('Range profile will appear here after Ping.', 54 * s, 22 * s);
}
