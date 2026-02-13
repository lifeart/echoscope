import { store } from '../core/store.js';
import { createProbe } from '../signal/probe-factory.js';
import { getCanvasCtx } from './renderer.js';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleSignalPreview(): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(drawSignalPreview, 200);
}

export function drawSignalPreview(): void {
  const state = store.get();
  const sr = state.audio.actualSampleRate || 48000;
  const probe = createProbe(state.config.probe, sr);

  if (probe.type === 'golay' && probe.a && probe.b) {
    drawPreviewCanvas('previewGolay', [
      { data: probe.a, color: '#6fa8dc' },
      { data: probe.b, color: '#e69138' },
    ], sr);
  } else if (probe.ref) {
    const id = probe.type === 'chirp' ? 'previewChirp' : 'previewMls';
    drawPreviewCanvas(id, [{ data: probe.ref, color: '#8dd0ff' }], sr);
  }
}

interface WaveSpec { data: Float32Array; color: string }

function drawPreviewCanvas(canvasId: string, waves: WaveSpec[], sr: number): void {
  const r = getCanvasCtx(canvasId);
  if (!r) return;
  const { ctx, w, h, s } = r;

  ctx.fillStyle = '#070707';
  ctx.fillRect(0, 0, w, h);

  const pad = 4 * s;
  const plotW = w - pad * 2;
  const slotH = (h - pad * 2) / waves.length;

  for (let wi = 0; wi < waves.length; wi++) {
    const { data, color } = waves[wi];
    const baseY = pad + wi * slotH;
    const midY = baseY + slotH / 2;
    const halfH = (slotH / 2) * 0.85;

    // find absMax for scaling
    let absMax = 0;
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > absMax) absMax = v;
    }
    if (absMax < 1e-12) absMax = 1;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1 * s;
    ctx.beginPath();

    if (data.length <= plotW) {
      // draw every sample
      for (let i = 0; i < data.length; i++) {
        const x = pad + (i / Math.max(1, data.length - 1)) * plotW;
        const y = midY - (data[i] / absMax) * halfH;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    } else {
      // decimate: min/max per pixel column
      const cols = Math.floor(plotW);
      for (let col = 0; col < cols; col++) {
        const i0 = Math.floor((col / cols) * data.length);
        const i1 = Math.min(data.length - 1, Math.floor(((col + 1) / cols) * data.length));
        let mn = data[i0], mx2 = data[i0];
        for (let i = i0 + 1; i <= i1; i++) {
          if (data[i] < mn) mn = data[i];
          if (data[i] > mx2) mx2 = data[i];
        }
        const x = pad + col;
        const yMin = midY - (mx2 / absMax) * halfH;
        const yMax = midY - (mn / absMax) * halfH;
        if (col === 0) ctx.moveTo(x, yMin); else ctx.lineTo(x, yMin);
        ctx.lineTo(x, yMax);
      }
    }
    ctx.stroke();

    // label for first wave only
    if (wi === 0) {
      const totalSamples = waves.reduce((acc, wv) => acc + wv.data.length, 0);
      const durationMs = (totalSamples / sr) * 1000;
      ctx.fillStyle = '#9e9e9e';
      ctx.font = `${10 * s}px system-ui`;
      ctx.textAlign = 'left';
      ctx.fillText(`${totalSamples} samples, ${durationMs.toFixed(1)}ms`, pad + 2 * s, pad + 10 * s);
    }
    // wave label
    if (waves.length > 1) {
      ctx.fillStyle = color;
      ctx.font = `${10 * s}px system-ui`;
      ctx.textAlign = 'right';
      ctx.fillText(wi === 0 ? 'A' : 'B', w - pad - 2 * s, baseY + 12 * s);
    }
  }
}
