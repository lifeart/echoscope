import { clamp } from '../utils.js';
import { store } from '../core/store.js';
import { clearCanvas, getCanvasCtx } from './renderer.js';
import { traceColorFromConfidence } from './colors.js';
import { smoothHeatmapDisplay } from '../scan/heatmap-data.js';

export function drawHeatmap(minR: number, maxR: number): void {
  const r = getCanvasCtx('heatmap');
  if (!r) return;
  const { ctx, w, h, s } = r;
  clearCanvas(ctx, w, h);

  const state = store.get();
  const heatmap = state.heatmap;
  if (!heatmap || heatmap.angles.length === 0) return;

  smoothHeatmapDisplay(heatmap);

  let mx = 1e-9;
  for (let i = 0; i < heatmap.display.length; i++) {
    if (heatmap.display[i] > mx) mx = heatmap.display[i];
  }

  const rows = heatmap.angles.length;
  const cols = heatmap.bins;
  const wDen = Math.max(1, w - 1);
  const hDen = Math.max(1, h - 1);
  const rowDen = Math.max(1, rows - 1);
  const colDen = Math.max(1, cols - 1);

  // Cap heatmap resolution at DPR 2 to limit memory on high-DPR screens
  const maxDPR = 2;
  const rect = r.canvas.getBoundingClientRect();
  const heatW = Math.min(w, Math.round(rect.width * maxDPR)) || w;
  const heatH = Math.min(h, Math.round(rect.height * maxDPR)) || h;
  const heatWDen = Math.max(1, heatW - 1);
  const heatHDen = Math.max(1, heatH - 1);

  const img = ctx.createImageData(heatW, heatH);
  const data = img.data;

  for (let y = 0; y < heatH; y++) {
    const rowPos = (y / heatHDen) * rowDen;
    const r0 = Math.floor(rowPos);
    const r1 = Math.min(rows - 1, r0 + 1);
    const fr = rowPos - r0;
    for (let x = 0; x < heatW; x++) {
      const colPos = (x / heatWDen) * colDen;
      const c0 = Math.floor(colPos);
      const c1 = Math.min(cols - 1, c0 + 1);
      const fc = colPos - c0;

      const v00 = heatmap.display[r0 * cols + c0];
      const v01 = heatmap.display[r0 * cols + c1];
      const v10 = heatmap.display[r1 * cols + c0];
      const v11 = heatmap.display[r1 * cols + c1];
      const v0 = v00 + (v01 - v00) * fc;
      const v1 = v10 + (v11 - v10) * fc;
      const v = (v0 + (v1 - v0) * fr) / mx;
      const g = Math.floor(255 * clamp(v, 0, 1));
      const idx = (y * heatW + x) * 4;
      data[idx] = g; data[idx + 1] = g; data[idx + 2] = g; data[idx + 3] = 255;
    }
  }
  // Draw scaled: ImageData is at capped resolution, stretch to full canvas
  if (heatW === w && heatH === h) {
    ctx.putImageData(img, 0, 0);
  } else {
    const tmp = new OffscreenCanvas(heatW, heatH);
    const tmpCtx = tmp.getContext('2d')!;
    tmpCtx.putImageData(img, 0, 0);
    ctx.drawImage(tmp, 0, 0, w, h);
  }

  ctx.fillStyle = '#eaeaea';
  ctx.font = `${12 * s}px system-ui`;
  ctx.fillText('Angle \u00d7 Range heatmap (brighter = stronger echo energy)', 12 * s, 18 * s);

  ctx.fillStyle = '#bdbdbd';
  ctx.fillText(`angles: ${heatmap.angles[0]}..${heatmap.angles[heatmap.angles.length - 1]} deg`, 12 * s, 36 * s);
  ctx.fillText(`range: ${minR}..${maxR} m`, 12 * s, 52 * s);

  // Best-target trace
  const showTrace = (document.getElementById('showTrace') as HTMLInputElement)?.checked;
  if (showTrace && heatmap.bestBin && heatmap.bestBin.length === rows) {
    const gate = state.config.strengthGate;
    ctx.lineWidth = 2 * s;
    let prev: { x: number; y: number; conf: number } | null = null;
    for (let ri = 0; ri < rows; ri++) {
      const b = heatmap.bestBin[ri];
      if (b < 0) continue;
      const x = (b / colDen) * (w - 1);
      const y = (ri / rowDen) * (h - 1);
      const conf = clamp((heatmap.bestVal[ri] - gate) / Math.max(1e-6, 1 - gate), 0, 1);
      if (prev) {
        const segConf = 0.5 * (prev.conf + conf);
        ctx.strokeStyle = traceColorFromConfidence(segConf);
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      prev = { x, y, conf };
    }

    for (let ri = 0; ri < rows; ri++) {
      const b = heatmap.bestBin[ri];
      if (b < 0) continue;
      const x = (b / colDen) * (w - 1);
      const y = (ri / rowDen) * (h - 1);
      const conf = clamp((heatmap.bestVal[ri] - gate) / Math.max(1e-6, 1 - gate), 0, 1);
      ctx.fillStyle = traceColorFromConfidence(conf);
      ctx.beginPath(); ctx.arc(x, y, 3 * s, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = traceColorFromConfidence(0.15);
    ctx.fillText('Best-target trace', 12 * s, 70 * s);
    ctx.fillStyle = traceColorFromConfidence(0.85);
    ctx.fillText('low\u2192high confidence', 128 * s, 70 * s);
  }
}
