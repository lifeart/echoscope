import { clearCanvas, getCanvasCtx } from './renderer.js';

export function drawCalibSanityPlot(
  curveL: Float32Array,
  peakIdxL: number,
  curveR: Float32Array,
  peakIdxR: number,
  earlyMs: number,
): void {
  const r = getCanvasCtx('calibPlot');
  if (!r) return;
  const { ctx, w, h, s } = r;
  const xPad = 50 * s;
  const yTop = 15 * s;
  const boxW = w - 65 * s;
  const boxH = h - 45 * s;
  clearCanvas(ctx, w, h);

  if (!curveL.length || !curveR.length) {
    ctx.fillStyle = '#bdbdbd';
    ctx.font = `${12 * s}px system-ui`;
    ctx.fillText('Sanity plot unavailable: empty correlation window.', 54 * s, 22 * s);
    return;
  }

  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1 * s;
  ctx.strokeRect(xPad, yTop, boxW, boxH);

  let minV = 1e9, maxV = -1e9;
  for (let i = 0; i < curveL.length; i++) { const v = curveL[i]; if (v < minV) minV = v; if (v > maxV) maxV = v; }
  for (let i = 0; i < curveR.length; i++) { const v = curveR[i]; if (v < minV) minV = v; if (v > maxV) maxV = v; }
  const pad = 0.08;
  const yMin = minV - pad;
  const yMax = maxV + pad;
  const ySpan = Math.max(1e-6, yMax - yMin);

  function xy(i: number, v: number, N: number) {
    const den = Math.max(1, N - 1);
    const x = xPad + (i / den) * boxW;
    const y = (yTop + boxH) - ((v - yMin) / ySpan) * boxH;
    return { x, y };
  }

  ctx.strokeStyle = 'rgba(140,210,255,0.95)';
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  for (let i = 0; i < curveL.length; i++) {
    const p = xy(i, curveL[i], curveL.length);
    if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,190,120,0.95)';
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  for (let i = 0; i < curveR.length; i++) {
    const p = xy(i, curveR[i], curveR.length);
    if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  const pL = xy(peakIdxL, curveL[peakIdxL], curveL.length);
  const pR = xy(peakIdxR, curveR[peakIdxR], curveR.length);

  ctx.fillStyle = 'rgba(140,210,255,0.95)';
  ctx.beginPath(); ctx.arc(pL.x, pL.y, 4 * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,190,120,0.95)';
  ctx.beginPath(); ctx.arc(pR.x, pR.y, 4 * s, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = '#eaeaea';
  ctx.font = `${12 * s}px system-ui`;
  ctx.fillText(`Calibration sanity: early ${earlyMs} ms (Golay-summed correlation)`, 54 * s, 12 * s);
  ctx.fillStyle = 'rgba(140,210,255,0.95)';
  ctx.fillText('L-only', 54 * s, h - 18 * s);
  ctx.fillStyle = 'rgba(255,190,120,0.95)';
  ctx.fillText('R-only', 110 * s, h - 18 * s);
  ctx.fillStyle = '#bdbdbd';
  ctx.fillText('time \u2192', w - 70 * s, h - 18 * s);
}

export function drawSanityPlaceholder(): void {
  const r = getCanvasCtx('calibPlot');
  if (!r) return;
  const { ctx, w, h, s } = r;
  clearCanvas(ctx, w, h);
  ctx.fillStyle = '#bdbdbd';
  ctx.font = `${12 * s}px system-ui`;
  ctx.fillText('Sanity plot will appear after calibration.', 54 * s, 22 * s);
}
