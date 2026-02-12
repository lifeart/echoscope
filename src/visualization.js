import { state } from './state.js';
import { clamp } from './utils.js';
import { el } from './dom.js';
import { getStrengthGate } from './profile.js';

export function canvasPixelScale(canvas) {
  const rect = canvas.getBoundingClientRect();
  if (!(rect.width > 0)) return 1;
  return Math.max(1, canvas.width / rect.width);
}

export function resizeCanvasForDPR(canvas) {
  const rect = canvas.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return false;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const targetW = Math.max(1, Math.round(rect.width * dpr));
  const targetH = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width === targetW && canvas.height === targetH) return false;
  canvas.width = targetW;
  canvas.height = targetH;
  return true;
}

export function applyRetinaCanvases() {
  const a = resizeCanvasForDPR(el("profile"));
  const b = resizeCanvasForDPR(el("heatmap"));
  const c = resizeCanvasForDPR(el("calibPlot"));
  const d = resizeCanvasForDPR(el("geometry"));
  return a || b || c || d;
}

export function traceColorFromConfidence(conf) {
  const c = clamp(conf, 0, 1);
  const hue = 35 * (1 - c);
  return `hsla(${hue}, 96%, 62%, 0.95)`;
}

export function clearCanvas(ctx, w, h) {
  ctx.fillStyle = "#070707";
  ctx.fillRect(0, 0, w, h);
}

export function drawProfile(corr, tau0, c, minR, maxR) {
  const profileCanvas = el("profile");
  const pctx = profileCanvas.getContext("2d");
  const w = profileCanvas.width, h = profileCanvas.height;
  const s = canvasPixelScale(profileCanvas);
  const xPad = 50 * s;
  const yTop = 10 * s;
  const yBottom = h - 30 * s;
  const xRight = w - 10 * s;
  const xSpan = w - 70 * s;
  const ySpan = h - 50 * s;
  clearCanvas(pctx, w, h);

  pctx.strokeStyle = "#333";
  pctx.lineWidth = 1 * s;
  pctx.beginPath();
  pctx.moveTo(xPad, yTop);
  pctx.lineTo(xPad, yBottom);
  pctx.lineTo(xRight, yBottom);
  pctx.stroke();

  const minTau = (2 * minR) / c;
  const maxTau = (2 * maxR) / c;

  pctx.strokeStyle = "#8dd0ff";
  pctx.lineWidth = 2 * s;
  pctx.beginPath();
  let started = false;

  for (let i = 0; i < corr.length; i++) {
    const tau = (i / state.sr) - tau0;
    if (tau < minTau || tau > maxTau) continue;
    const R = (c * tau) / 2;

    const x = xPad + (R - minR) / (maxR - minR) * xSpan;
    const y = yBottom - ((corr[i] * 0.5 + 0.5) * ySpan);

    if (!started) { pctx.moveTo(x, y); started = true; }
    else pctx.lineTo(x, y);
  }
  pctx.stroke();

  pctx.fillStyle = "#bdbdbd";
  pctx.font = `${12 * s}px system-ui`;
  pctx.fillText(`Range profile (calibrated). minR=${minR}m maxR=${maxR}m`, 54 * s, 22 * s);
}

export function drawHeatmap(minR, maxR) {
  const heatCanvas = el("heatmap");
  const hctx = heatCanvas.getContext("2d");
  const w = heatCanvas.width, h = heatCanvas.height;
  const s = canvasPixelScale(heatCanvas);
  clearCanvas(hctx, w, h);

  if (!state.heat || state.heatAngles.length === 0) return;

  if (!state.heatDisplay || state.heatDisplay.length !== state.heat.length) {
    state.heatDisplay = new Float32Array(state.heat.length);
    state.heatDisplay.set(state.heat);
  }

  const smoothAlpha = 0.22;
  for (let i = 0; i < state.heat.length; i++) {
    state.heatDisplay[i] += smoothAlpha * (state.heat[i] - state.heatDisplay[i]);
  }

  let mx = 1e-9;
  for (let i = 0; i < state.heatDisplay.length; i++) if (state.heatDisplay[i] > mx) mx = state.heatDisplay[i];

  const rows = state.heatAngles.length;
  const cols = state.heatBins;
  const wDen = Math.max(1, w - 1);
  const hDen = Math.max(1, h - 1);
  const rowDen = Math.max(1, rows - 1);
  const colDen = Math.max(1, cols - 1);

  const img = hctx.createImageData(w, h);
  const data = img.data;

  for (let y = 0; y < h; y++) {
    const rowPos = (y / hDen) * rowDen;
    const r0 = Math.floor(rowPos);
    const r1 = Math.min(rows - 1, r0 + 1);
    const fr = rowPos - r0;
    for (let x = 0; x < w; x++) {
      const colPos = (x / wDen) * colDen;
      const c0 = Math.floor(colPos);
      const c1 = Math.min(cols - 1, c0 + 1);
      const fc = colPos - c0;

      const v00 = state.heatDisplay[r0 * cols + c0];
      const v01 = state.heatDisplay[r0 * cols + c1];
      const v10 = state.heatDisplay[r1 * cols + c0];
      const v11 = state.heatDisplay[r1 * cols + c1];
      const v0 = v00 + (v01 - v00) * fc;
      const v1 = v10 + (v11 - v10) * fc;
      const v = (v0 + (v1 - v0) * fr) / mx;
      const g = Math.floor(255 * clamp(v, 0, 1));
      const idx = (y * w + x) * 4;
      data[idx + 0] = g; data[idx + 1] = g; data[idx + 2] = g; data[idx + 3] = 255;
    }
  }
  hctx.putImageData(img, 0, 0);

  hctx.fillStyle = "#eaeaea";
  hctx.font = `${12 * s}px system-ui`;
  hctx.fillText("Angle \u00d7 Range heatmap (brighter = stronger echo energy)", 12 * s, 18 * s);

  hctx.fillStyle = "#bdbdbd";
  hctx.fillText(`angles: ${state.heatAngles[0]}..${state.heatAngles[state.heatAngles.length - 1]} deg`, 12 * s, 36 * s);
  hctx.fillText(`range: ${minR}..${maxR} m`, 12 * s, 52 * s);

  const showTraceEl = el("showTrace");
  if (showTraceEl.checked && state.bestBin && state.bestBin.length === rows) {
    const gate = getStrengthGate();
    hctx.lineWidth = 2 * s;
    let prev = null;
    for (let r = 0; r < rows; r++) {
      const b = state.bestBin[r];
      if (b < 0) continue;
      const x = (b / colDen) * (w - 1);
      const y = (r / rowDen) * (h - 1);
      const conf = clamp((state.bestVal[r] - gate) / Math.max(1e-6, 1 - gate), 0, 1);
      if (prev) {
        const segConf = 0.5 * (prev.conf + conf);
        hctx.strokeStyle = traceColorFromConfidence(segConf);
        hctx.beginPath();
        hctx.moveTo(prev.x, prev.y);
        hctx.lineTo(x, y);
        hctx.stroke();
      }
      prev = { x, y, conf };
    }

    for (let r = 0; r < rows; r++) {
      const b = state.bestBin[r];
      if (b < 0) continue;
      const x = (b / colDen) * (w - 1);
      const y = (r / rowDen) * (h - 1);
      const conf = clamp((state.bestVal[r] - gate) / Math.max(1e-6, 1 - gate), 0, 1);
      hctx.fillStyle = traceColorFromConfidence(conf);
      hctx.beginPath(); hctx.arc(x, y, 3 * s, 0, Math.PI * 2); hctx.fill();
    }
    hctx.fillStyle = traceColorFromConfidence(0.15);
    hctx.fillText("Best-target trace", 12 * s, 70 * s);
    hctx.fillStyle = traceColorFromConfidence(0.85);
    hctx.fillText("low\u2192high confidence", 128 * s, 70 * s);
  }
}

export function drawCalibSanityPlot(curveL, peakIdxL, curveR, peakIdxR, earlyMs) {
  const calibPlot = el("calibPlot");
  const cctx = calibPlot.getContext("2d");
  const w = calibPlot.width, h = calibPlot.height;
  const s = canvasPixelScale(calibPlot);
  const xPad = 50 * s;
  const yTop = 15 * s;
  const boxW = w - 65 * s;
  const boxH = h - 45 * s;
  clearCanvas(cctx, w, h);

  if (!curveL.length || !curveR.length) {
    cctx.fillStyle = "#bdbdbd";
    cctx.font = `${12 * s}px system-ui`;
    cctx.fillText("Sanity plot unavailable: empty correlation window.", 54 * s, 22 * s);
    return;
  }

  cctx.strokeStyle = "#333";
  cctx.lineWidth = 1 * s;
  cctx.strokeRect(xPad, yTop, boxW, boxH);

  let minV = 1e9, maxV = -1e9;
  for (let i = 0; i < curveL.length; i++) { const v = curveL[i]; if (v < minV) minV = v; if (v > maxV) maxV = v; }
  for (let i = 0; i < curveR.length; i++) { const v = curveR[i]; if (v < minV) minV = v; if (v > maxV) maxV = v; }
  const pad = 0.08;
  const yMin = minV - pad;
  const yMax = maxV + pad;
  const ySpan = Math.max(1e-6, yMax - yMin);

  function xy(i, v, N) {
    const den = Math.max(1, N - 1);
    const x = xPad + (i / den) * boxW;
    const y = (yTop + boxH) - ((v - yMin) / ySpan) * boxH;
    return { x, y };
  }

  cctx.strokeStyle = "rgba(140,210,255,0.95)";
  cctx.lineWidth = 2 * s;
  cctx.beginPath();
  for (let i = 0; i < curveL.length; i++) {
    const p = xy(i, curveL[i], curveL.length);
    if (i === 0) cctx.moveTo(p.x, p.y);
    else cctx.lineTo(p.x, p.y);
  }
  cctx.stroke();

  cctx.strokeStyle = "rgba(255,190,120,0.95)";
  cctx.lineWidth = 2 * s;
  cctx.beginPath();
  for (let i = 0; i < curveR.length; i++) {
    const p = xy(i, curveR[i], curveR.length);
    if (i === 0) cctx.moveTo(p.x, p.y);
    else cctx.lineTo(p.x, p.y);
  }
  cctx.stroke();

  const pL = xy(peakIdxL, curveL[peakIdxL], curveL.length);
  const pR = xy(peakIdxR, curveR[peakIdxR], curveR.length);

  cctx.fillStyle = "rgba(140,210,255,0.95)";
  cctx.beginPath(); cctx.arc(pL.x, pL.y, 4 * s, 0, Math.PI * 2); cctx.fill();
  cctx.fillStyle = "rgba(255,190,120,0.95)";
  cctx.beginPath(); cctx.arc(pR.x, pR.y, 4 * s, 0, Math.PI * 2); cctx.fill();

  cctx.fillStyle = "#eaeaea";
  cctx.font = `${12 * s}px system-ui`;
  cctx.fillText(`Calibration sanity: early ${earlyMs} ms (Golay-summed correlation)`, 54 * s, 12 * s);

  cctx.fillStyle = "rgba(140,210,255,0.95)";
  cctx.fillText("L-only", 54 * s, h - 18 * s);

  cctx.fillStyle = "rgba(255,190,120,0.95)";
  cctx.fillText("R-only", 110 * s, h - 18 * s);

  cctx.fillStyle = "#bdbdbd";
  cctx.fillText("time \u2192", w - 70 * s, h - 18 * s);
}

export function drawProfilePlaceholder() {
  const profileCanvas = el("profile");
  const pctx = profileCanvas.getContext("2d");
  clearCanvas(pctx, profileCanvas.width, profileCanvas.height);
  const s = canvasPixelScale(profileCanvas);
  pctx.fillStyle = "#bdbdbd";
  pctx.font = `${12 * s}px system-ui`;
  pctx.fillText("Range profile will appear here after Ping.", 54 * s, 22 * s);
}

export function drawSanityPlaceholder() {
  const calibPlot = el("calibPlot");
  const cctx = calibPlot.getContext("2d");
  clearCanvas(cctx, calibPlot.width, calibPlot.height);
  const s = canvasPixelScale(calibPlot);
  cctx.fillStyle = "#bdbdbd";
  cctx.font = `${12 * s}px system-ui`;
  cctx.fillText("Sanity plot will appear after calibration.", 54 * s, 22 * s);
}
