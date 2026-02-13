import { clamp } from '../utils.js';
import { store } from '../core/store.js';
import { clearCanvas } from './renderer.js';
import { traceColorFromConfidence } from './colors.js';
import { smoothHeatmapDisplay } from '../scan/heatmap-data.js';
import { drawTooltip } from './tooltip.js';
import { canvasPixelScale } from './renderer.js';

/* ---- mouse state ---- */
let heatMousePos: { x: number; y: number } | null = null;
let cachedImageData: ImageData | null = null;

export function setHeatmapMouse(pos: { x: number; y: number } | null): void {
  heatMousePos = pos;
}

/* ---- context with willReadFrequently ---- */
let heatCtx: CanvasRenderingContext2D | null = null;

function getHeatmapCtx(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; w: number; h: number; s: number } | null {
  const canvas = document.getElementById('heatmap') as HTMLCanvasElement | null;
  if (!canvas) return null;
  if (!heatCtx) {
    heatCtx = canvas.getContext('2d', { willReadFrequently: true });
  }
  if (!heatCtx) return null;
  return { canvas, ctx: heatCtx, w: canvas.width, h: canvas.height, s: canvasPixelScale(canvas) };
}

/* ---- layout (pixel-aligned) ---- */
function heatLayout(s: number, w: number, h: number) {
  const xPad = Math.round(50 * s);
  const yPad = Math.round(22 * s);
  const xRight = Math.round(w - 12 * s);
  const yBottom = Math.round(h - 46 * s);
  const plotW = xRight - xPad;
  const plotH = yBottom - yPad;
  return { xPad, yPad, xRight, yBottom, plotW, plotH };
}

export function drawHeatmap(minR: number, maxR: number): void {
  const r = getHeatmapCtx();
  if (!r) {
    console.warn('[drawHeatmap] no canvas context');
    return;
  }
  const { ctx, w, h, s } = r;
  console.log(`[drawHeatmap] canvas w=${w} h=${h} scale=${s} minR=${minR} maxR=${maxR}`);
  clearCanvas(ctx, w, h);
  cachedImageData = null;

  const state = store.get();
  const heatmap = state.heatmap;
  if (!heatmap || heatmap.angles.length === 0) {
    console.warn('[drawHeatmap] no heatmap in store or empty angles');
    return;
  }

  console.log(`[drawHeatmap] heatmap angles=${heatmap.angles.length} bins=${heatmap.bins} data.length=${heatmap.data.length} display.length=${heatmap.display.length}`);

  smoothHeatmapDisplay(heatmap);

  const { xPad, yPad, yBottom, plotW, plotH } = heatLayout(s, w, h);
  console.log(`[drawHeatmap] layout xPad=${xPad} yPad=${yPad} yBottom=${yBottom} plotW=${plotW} plotH=${plotH}`);

  // find max display value
  let dataMax = 0;
  let displayMax = 0;
  let nonZeroCount = 0;
  for (let i = 0; i < heatmap.display.length; i++) {
    if (heatmap.data[i] > dataMax) dataMax = heatmap.data[i];
    if (heatmap.display[i] > displayMax) displayMax = heatmap.display[i];
    if (heatmap.display[i] > 1e-15) nonZeroCount++;
  }

  const hasData = displayMax > 1e-12;

  console.log(`[drawHeatmap] dataMax=${dataMax.toExponential(3)} displayMax=${displayMax.toExponential(3)} nonZero=${nonZeroCount}/${heatmap.display.length} hasData=${hasData}`);

  const rows = heatmap.angles.length;
  const cols = heatmap.bins;

  if (hasData && plotW > 0 && plotH > 0) {
    const pW = Math.max(1, plotW);
    const pH = Math.max(1, plotH);
    const wDen = Math.max(1, pW - 1);
    const hDen = Math.max(1, pH - 1);
    const rowDen = Math.max(1, rows - 1);
    const colDen = Math.max(1, cols - 1);

    console.log(`[drawHeatmap] creating ImageData pW=${pW} pH=${pH} rows=${rows} cols=${cols}`);

    const img = ctx.createImageData(pW, pH);
    const data = img.data;

    let pixMin = 255, pixMax = 0, pixNonZero = 0;
    for (let y = 0; y < pH; y++) {
      const colPos = (1 - y / hDen) * colDen;
      const c0 = Math.floor(colPos);
      const c1 = Math.min(cols - 1, c0 + 1);
      const fc = colPos - c0;
      for (let x = 0; x < pW; x++) {
        const rowPos = (x / wDen) * rowDen;
        const r0 = Math.floor(rowPos);
        const r1 = Math.min(rows - 1, r0 + 1);
        const fr = rowPos - r0;

        const v00 = heatmap.display[r0 * cols + c0];
        const v01 = heatmap.display[r0 * cols + c1];
        const v10 = heatmap.display[r1 * cols + c0];
        const v11 = heatmap.display[r1 * cols + c1];
        const v0 = v00 + (v01 - v00) * fc;
        const v1 = v10 + (v11 - v10) * fc;
        const v = (v0 + (v1 - v0) * fr) / displayMax;
        const g = Math.floor(255 * clamp(v, 0, 1));
        if (g < pixMin) pixMin = g;
        if (g > pixMax) pixMax = g;
        if (g > 0) pixNonZero++;
        const idx = (y * pW + x) * 4;
        data[idx] = g; data[idx + 1] = g; data[idx + 2] = g; data[idx + 3] = 255;
      }
    }
    console.log(`[drawHeatmap] pixel stats: min=${pixMin} max=${pixMax} nonZero=${pixNonZero}/${pW * pH} putImageData at (${xPad}, ${yPad})`);
    ctx.putImageData(img, xPad, yPad);
  }

  // X-axis ticks (angle, rotated 45°)
  ctx.font = `${8 * s}px system-ui`;
  const angleStep = rows <= 7 ? 1 : 2;
  for (let ri = 0; ri < rows; ri += angleStep) {
    const frac = ri / Math.max(1, rows - 1);
    const px = xPad + frac * plotW;
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1 * s;
    ctx.beginPath();
    ctx.moveTo(px, yBottom);
    ctx.lineTo(px, yBottom + 5 * s);
    ctx.stroke();
    ctx.save();
    ctx.translate(px, yBottom + 8 * s);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = '#9e9e9e';
    ctx.textAlign = 'right';
    ctx.fillText(heatmap.angles[ri] + '\u00b0', 0, 0);
    ctx.restore();
  }

  // Y-axis ticks (range)
  ctx.textAlign = 'right';
  const nyTicks = 6;
  for (let t = 0; t <= nyTicks; t++) {
    const frac = t / nyTicks;
    const rangeVal = maxR - frac * (maxR - minR);
    const py = yPad + frac * plotH;
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1 * s;
    ctx.beginPath();
    ctx.moveTo(xPad - 5 * s, py);
    ctx.lineTo(xPad, py);
    ctx.stroke();
    ctx.fillStyle = '#9e9e9e';
    ctx.fillText(rangeVal.toFixed(1) + 'm', xPad - 8 * s, py + 4 * s);
  }

  // Title
  ctx.fillStyle = '#eaeaea';
  ctx.font = `${12 * s}px system-ui`;
  ctx.textAlign = 'left';
  ctx.fillText('Angle \u00d7 Range heatmap (brighter = stronger echo energy)', xPad + 4 * s, yPad - 6 * s);

  // Placeholder text when no data
  if (!hasData) {
    ctx.fillStyle = '#666';
    ctx.font = `${12 * s}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText('Run a Scan to populate heatmap', xPad + plotW / 2, yPad + plotH / 2);
  }

  // Best-target trace (dots only, no connecting lines)
  const colDen = Math.max(1, cols - 1);
  const rowDen = Math.max(1, rows - 1);
  const showTrace = (document.getElementById('showTrace') as HTMLInputElement)?.checked;
  if (showTrace && heatmap.bestBin && heatmap.bestBin.length === rows) {
    const gate = state.config.strengthGate;
    for (let ri = 0; ri < rows; ri++) {
      const b = heatmap.bestBin[ri];
      if (b < 0) continue;
      const x = xPad + (ri / rowDen) * plotW;
      const y = yPad + (1 - b / colDen) * plotH;
      const conf = clamp((heatmap.bestVal[ri] - gate) / Math.max(1e-6, 1 - gate), 0, 1);
      ctx.fillStyle = traceColorFromConfidence(conf);
      ctx.beginPath(); ctx.arc(x, y, 3 * s, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = traceColorFromConfidence(0.15);
    ctx.textAlign = 'left';
    ctx.fillText('Best-target trace', xPad + 4 * s, yBottom + 28 * s);
    ctx.fillStyle = traceColorFromConfidence(0.85);
    ctx.fillText('low\u2192high confidence', xPad + 120 * s, yBottom + 28 * s);
  }

  // Cache for crosshair overlay
  cachedImageData = ctx.getImageData(0, 0, w, h);

  // Draw crosshair if mouse is over
  drawHeatmapCrosshair(ctx, w, h, s, minR, maxR, heatmap);
}

function drawHeatmapCrosshair(
  ctx: CanvasRenderingContext2D, w: number, h: number, s: number,
  minR: number, maxR: number,
  heatmap: { angles: number[]; bins: number; display: Float32Array },
): void {
  if (!heatMousePos) return;
  const { xPad, yPad, xRight, yBottom, plotW, plotH } = heatLayout(s, w, h);
  const mx = heatMousePos.x;
  const my = heatMousePos.y;
  if (mx < xPad || mx > xRight || my < yPad || my > yBottom) return;

  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1 * s;
  ctx.setLineDash([4 * s, 3 * s]);
  ctx.beginPath();
  ctx.moveTo(mx, yPad);
  ctx.lineTo(mx, yBottom);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(xPad, my);
  ctx.lineTo(xRight, my);
  ctx.stroke();
  ctx.setLineDash([]);

  const angleFrac = (mx - xPad) / plotW;
  const rangeFrac = 1 - (my - yPad) / plotH;
  const range = minR + rangeFrac * (maxR - minR);
  const rows = heatmap.angles.length;
  const angleIdx = clamp(Math.round(angleFrac * (rows - 1)), 0, rows - 1);
  const angle = heatmap.angles[angleIdx];

  const cols = heatmap.bins;
  const colIdx = clamp(Math.round(rangeFrac * (cols - 1)), 0, cols - 1);
  const strength = heatmap.display[angleIdx * cols + colIdx];

  drawTooltip(ctx, [
    `Angle: ${angle}\u00b0`,
    `Range: ${range.toFixed(2)}m`,
    `Strength: ${strength.toFixed(4)}`,
  ], mx, my, s, w, h);
}

export function redrawHeatmapCrosshair(): void {
  const r = getHeatmapCtx();
  if (!r) return;
  const { ctx, w, h, s } = r;
  if (!cachedImageData) return;
  const state = store.get();
  const heatmap = state.heatmap;
  if (!heatmap || heatmap.angles.length === 0) return;

  ctx.putImageData(cachedImageData, 0, 0);
  drawHeatmapCrosshair(ctx, w, h, s, state.config.minRange, state.config.maxRange, heatmap);
}
