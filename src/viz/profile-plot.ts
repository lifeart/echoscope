import { store } from '../core/store.js';
import { clearCanvas, getCanvasCtx } from './renderer.js';
import { drawTooltip } from './tooltip.js';

/* ---- mouse state ---- */
let mousePos: { x: number; y: number } | null = null;

export function setProfileMouse(pos: { x: number; y: number } | null): void {
  mousePos = pos;
}

/* ---- nice tick values ---- */
function niceStep(range: number, maxTicks: number): number {
  const rough = range / maxTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const res = rough / mag;
  if (res <= 1) return mag;
  if (res <= 2) return 2 * mag;
  if (res <= 5) return 5 * mag;
  return 10 * mag;
}

/* ---- layout constants (pixel-aligned) ---- */
function layout(s: number, w: number, h: number) {
  const xPad = Math.round(58 * s);
  const yTop = Math.round(10 * s);
  const yBottom = Math.round(h - 44 * s);
  const xRight = Math.round(w - 12 * s);
  const xSpan = xRight - xPad;
  const ySpan = yBottom - yTop;
  return { xPad, yTop, yBottom, xRight, xSpan, ySpan };
}

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
  const { xPad, yTop, yBottom, xRight, xSpan, ySpan } = layout(s, w, h);

  clearCanvas(ctx, w, h);

  // axes
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  ctx.moveTo(xPad, yTop);
  ctx.lineTo(xPad, yBottom);
  ctx.lineTo(xRight, yBottom);
  ctx.stroke();

  const minTau = (2 * minR) / c;
  const maxTau = (2 * maxR) / c;

  // auto-scale
  let absMax = 0;
  for (let i = 0; i < corr.length; i++) {
    const tau = (i / sr) - tau0;
    if (tau < minTau || tau > maxTau) continue;
    const v = Math.abs(corr[i]);
    if (v > absMax) absMax = v;
  }
  if (absMax < 1e-12) absMax = 1;
  const scale = 1 / absMax;

  // X-axis ticks (range)
  ctx.fillStyle = '#9e9e9e';
  ctx.font = `${10 * s}px system-ui`;
  ctx.textAlign = 'center';
  const xStep = niceStep(maxR - minR, 6);
  const xStart = Math.ceil(minR / xStep) * xStep;
  for (let v = xStart; v <= maxR + xStep * 0.001; v += xStep) {
    const px = xPad + ((v - minR) / (maxR - minR)) * xSpan;
    ctx.strokeStyle = '#333';
    ctx.beginPath();
    ctx.moveTo(px, yBottom);
    ctx.lineTo(px, yBottom + 5 * s);
    ctx.stroke();
    ctx.fillText(v.toFixed(1) + 'm', px, yBottom + 16 * s);
  }
  // X-axis title
  ctx.font = `${11 * s}px system-ui`;
  ctx.fillText('Range (m)', xPad + xSpan / 2, yBottom + 32 * s);

  // Y-axis ticks (amplitude)
  ctx.textAlign = 'right';
  ctx.font = `${10 * s}px system-ui`;
  const yTicks = 4;
  for (let t = 0; t <= yTicks; t++) {
    const frac = t / yTicks; // 0..1
    const val = absMax * (1 - 2 * frac); // +absMax to -absMax
    const norm = val * scale * 0.5 + 0.5; // 0..1 within plot
    const py = yBottom - norm * ySpan;
    ctx.strokeStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.moveTo(xPad - 5 * s, py);
    ctx.lineTo(xPad, py);
    ctx.stroke();
    ctx.fillStyle = '#9e9e9e';
    ctx.fillText(val.toFixed(2), xPad - 8 * s, py + 4 * s);
  }

  // waveform
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

  // title
  ctx.fillStyle = '#bdbdbd';
  ctx.font = `${12 * s}px system-ui`;
  ctx.textAlign = 'left';
  ctx.fillText(`Range profile (calibrated)`, xPad + 4 * s, yTop + 14 * s);

  // crosshair
  if (mousePos) {
    const mx = mousePos.x;
    const my = mousePos.y;
    if (mx >= xPad && mx <= xRight && my >= yTop && my <= yBottom) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1 * s;
      ctx.setLineDash([4 * s, 3 * s]);
      ctx.beginPath();
      ctx.moveTo(mx, yTop);
      ctx.lineTo(mx, yBottom);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(xPad, my);
      ctx.lineTo(xRight, my);
      ctx.stroke();
      ctx.setLineDash([]);

      const range = minR + ((mx - xPad) / xSpan) * (maxR - minR);
      const tauTarget = (2 * range) / c + tau0;
      const sampleIdx = Math.round(tauTarget * sr);
      let amplitude = 0;
      if (sampleIdx >= 0 && sampleIdx < corr.length) {
        amplitude = corr[sampleIdx];
      }

      drawTooltip(ctx, [
        `Range: ${range.toFixed(2)}m`,
        `Amplitude: ${amplitude.toFixed(4)}`,
      ], mx, my, s, w, h);
    }
  }
}

export function drawProfilePlaceholder(): void {
  const r = getCanvasCtx('profile');
  if (!r) return;
  const { ctx, w, h, s } = r;
  clearCanvas(ctx, w, h);
  ctx.fillStyle = '#bdbdbd';
  ctx.font = `${12 * s}px system-ui`;
  ctx.textAlign = 'left';
  ctx.fillText('Range profile will appear here after Ping.', Math.round(58 * s), Math.round(22 * s));
}
