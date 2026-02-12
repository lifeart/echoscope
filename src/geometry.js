import { state } from './state.js';
import { clamp } from './utils.js';
import { el, log, getDirectionAxis } from './dom.js';
import { estimateMicXY } from './dsp.js';
import { getStrengthGate } from './profile.js';
import { canvasPixelScale, clearCanvas, traceColorFromConfidence } from './visualization.js';
import { renderCalibInfo } from './calibration.js';

export function setGeomWizardStatus(msg) {
  const geomWizardStatusEl = el("geomWizardStatus");
  if (geomWizardStatusEl) geomWizardStatusEl.textContent = msg;
}

export function syncGeometryWizardControls() {
  const en = !!state.geomWizard.active;
  const btnGeomReset = el("btnGeomReset");
  const btnGeomApply = el("btnGeomApply");
  if (btnGeomReset) btnGeomReset.disabled = !en;
  if (btnGeomApply) btnGeomApply.disabled = !en;
}

export function getGeometryModelFromCurrent() {
  const d = parseFloat(el("spacing").value);
  const halfD = (Number.isFinite(d) && d > 0.02) ? (d / 2) : 0.1;
  const micU = (state.calib.valid && Number.isFinite(state.calib.x)) ? state.calib.x
            : (state.presetMicPosition.x !== null ? state.presetMicPosition.x : 0);
  const micF = (state.calib.valid && Number.isFinite(state.calib.y) && state.calib.y >= 0) ? state.calib.y
            : (state.presetMicPosition.y !== null ? state.presetMicPosition.y : 0.12);
  return {
    spL: { u: -halfD, f: 0 },
    spR: { u: halfD, f: 0 },
    mic: { u: micU, f: Math.max(0, micF) }
  };
}

export function ensureGeometryWizardHandlesInitialized(force = false) {
  if (!force && state.geomWizard.touched) return;
  const model = getGeometryModelFromCurrent();
  state.geomWizard.handles.spL = { u: model.spL.u, f: 0 };
  state.geomWizard.handles.spR = { u: model.spR.u, f: 0 };
  state.geomWizard.handles.mic = { u: model.mic.u, f: Math.max(0, model.mic.f) };
  if (force) state.geomWizard.touched = false;
}

export function resetGeometryWizardHandles() {
  ensureGeometryWizardHandlesInitialized(true);
  setGeomWizardStatus("Geometry handles reset from current spacing/calibration.");
  const minR = parseFloat(el("minR").value);
  const maxR = parseFloat(el("maxR").value);
  drawGeometry(minR, maxR);
}

export function applyGeometryWizard() {
  ensureGeometryWizardHandlesInitialized(false);
  const h = state.geomWizard.handles;
  const dNew = Math.abs(h.spR.u - h.spL.u);
  if (!(dNew > 0.02)) {
    setGeomWizardStatus("Apply failed: speaker spacing too small.");
    return;
  }

  const centerU = 0.5 * (h.spL.u + h.spR.u);
  const micX = h.mic.u - centerU;
  const micY = Math.max(0, h.mic.f);
  el("spacing").value = dNew.toFixed(3);

  if (state.calib.valid) {
    const rL = Math.hypot(h.mic.u - h.spL.u, micY - h.spL.f);
    const rR = Math.hypot(h.mic.u - h.spR.u, micY - h.spR.f);
    state.calib.d = dNew;
    state.calib.x = micX;
    state.calib.y = micY;
    state.calib.rL = rL;
    state.calib.rR = rR;
    state.calib.geomErr = estimateMicXY(rL, rR, dNew).err;
    renderCalibInfo();
    log(`[wizard] geometry applied: d=${dNew.toFixed(3)}m, mic\u2248(${micX.toFixed(3)}, ${micY.toFixed(3)})m`);
    setGeomWizardStatus("Applied to spacing and calibrated geometry.");
  } else {
    log(`[wizard] spacing updated to ${dNew.toFixed(3)}m (run calibration to apply mic geometry).`);
    setGeomWizardStatus("Applied spacing. Run calibration to lock mic geometry.");
  }

  const minR = parseFloat(el("minR").value);
  const maxR = parseFloat(el("maxR").value);
  drawGeometry(minR, maxR);
}

function getGeometryFrame(model, minR, maxR) {
  const geometryCanvas = el("geometry");
  const w = geometryCanvas.width;
  const h = geometryCanvas.height;
  const s = canvasPixelScale(geometryCanvas);
  const left = 34 * s;
  const right = w - 24 * s;
  const top = 20 * s;
  const bottom = h - 26 * s;
  const originY = bottom - 30 * s;
  const centerX = 0.5 * (left + right);
  const maxRange = (Number.isFinite(maxR) && maxR > 0.2) ? maxR : 4.0;
  const minRange = (Number.isFinite(minR) && minR >= 0) ? minR : 0.3;
  const yMax = Math.max(maxRange * 1.10, minRange + 0.4);

  let uLimit = Math.max(Math.abs(model.spL.u), Math.abs(model.spR.u), Math.abs(model.mic.u), 0.22) * 1.35;
  if (Number.isFinite(state.lastTargetAngle) && Number.isFinite(state.lastTargetRange)) {
    const tu = state.lastTargetRange * Math.sin(state.lastTargetAngle * Math.PI / 180);
    uLimit = Math.max(uLimit, Math.abs(tu) * 1.25);
  }

  function toPx(u, fwd) {
    const x = centerX + (u / Math.max(1e-6, uLimit)) * ((right - left) * 0.48);
    const y = originY - (fwd / Math.max(1e-6, yMax)) * (originY - top);
    return { x, y };
  }

  function fromPx(x, y) {
    const u = ((x - centerX) / Math.max(1e-6, (right - left) * 0.48)) * uLimit;
    const f = ((originY - y) / Math.max(1e-6, originY - top)) * yMax;
    return { u, f: Math.max(0, f) };
  }

  return { w, h, s, left, right, top, bottom, originY, centerX, yMax, uLimit, toPx, fromPx };
}

export function drawGeometry(minR, maxR) {
  if (state.geomWizard.active) ensureGeometryWizardHandlesInitialized(false);

  const model = state.geomWizard.active ? state.geomWizard.handles : getGeometryModelFromCurrent();
  const frame = getGeometryFrame(model, minR, maxR);
  const { w, h, s, left, right, top, originY, centerX, yMax, toPx } = frame;

  const geometryCanvas = el("geometry");
  const gctx = geometryCanvas.getContext("2d");
  clearCanvas(gctx, w, h);

  const axis = getDirectionAxis();
  const axisLabel = (axis === "vertical") ? "Z" : "X";
  const axisDirs = (axis === "vertical") ? ["Bottom", "Top"] : ["Left", "Right"];

  gctx.strokeStyle = "#2f2f2f";
  gctx.lineWidth = 1 * s;
  gctx.beginPath();
  gctx.moveTo(centerX, top);
  gctx.lineTo(centerX, originY);
  gctx.stroke();

  gctx.strokeStyle = "#3a3a3a";
  gctx.beginPath();
  gctx.moveTo(left, originY);
  gctx.lineTo(right, originY);
  gctx.stroke();

  const spLP = toPx(model.spL.u, 0);
  const spRP = toPx(model.spR.u, 0);
  const micP = toPx(model.mic.u, Math.max(0, model.mic.f));

  gctx.strokeStyle = "#6f6f6f";
  gctx.lineWidth = 2 * s;
  gctx.beginPath();
  gctx.moveTo(spLP.x, spLP.y);
  gctx.lineTo(spRP.x, spRP.y);
  gctx.stroke();

  function drawNode(p, color, rPx, label, selected = false) {
    gctx.fillStyle = color;
    gctx.beginPath();
    gctx.arc(p.x, p.y, rPx, 0, Math.PI * 2);
    gctx.fill();
    if (selected) {
      gctx.strokeStyle = "#f5f5f5";
      gctx.lineWidth = 1.2 * s;
      gctx.beginPath();
      gctx.arc(p.x, p.y, rPx + 3 * s, 0, Math.PI * 2);
      gctx.stroke();
    }
    gctx.fillStyle = "#d8d8d8";
    gctx.font = `${11 * s}px system-ui`;
    gctx.fillText(label, p.x + 7 * s, p.y - 7 * s);
  }

  drawNode(spLP, "#8dd0ff", 5 * s, "Speaker L", state.geomWizard.dragging === "spL");
  drawNode(spRP, "#8dd0ff", 5 * s, "Speaker R", state.geomWizard.dragging === "spR");
  drawNode(micP, state.calib.valid ? "#ffbf80" : "#8a8a8a", 5 * s, "Mic", state.geomWizard.dragging === "mic");

  if (state.geomWizard.active) {
    gctx.strokeStyle = "rgba(255,255,255,0.22)";
    gctx.setLineDash([4 * s, 4 * s]);
    gctx.beginPath();
    gctx.moveTo(micP.x, originY);
    gctx.lineTo(micP.x, micP.y);
    gctx.stroke();
    gctx.setLineDash([]);
  }

  const baselineCenterU = 0.5 * (model.spL.u + model.spR.u);
  const steerDeg = parseFloat(el("angle").value) || 0;
  const steerU = baselineCenterU + yMax * Math.sin(steerDeg * Math.PI / 180);
  const steerF = yMax * Math.cos(steerDeg * Math.PI / 180);
  const steerOrigin = toPx(baselineCenterU, 0);
  const steerEnd = toPx(steerU, Math.max(0, steerF));

  gctx.strokeStyle = "rgba(160,210,255,0.85)";
  gctx.lineWidth = 1.5 * s;
  gctx.setLineDash([5 * s, 5 * s]);
  gctx.beginPath();
  gctx.moveTo(steerOrigin.x, steerOrigin.y);
  gctx.lineTo(steerEnd.x, steerEnd.y);
  gctx.stroke();
  gctx.setLineDash([]);

  const gate = getStrengthGate();
  if (Number.isFinite(state.lastTargetAngle) && Number.isFinite(state.lastTargetRange) && state.lastTargetStrength > gate) {
    const targetU = baselineCenterU + state.lastTargetRange * Math.sin(state.lastTargetAngle * Math.PI / 180);
    const targetF = Math.max(0, state.lastTargetRange * Math.cos(state.lastTargetAngle * Math.PI / 180));
    const tp = toPx(targetU, targetF);
    gctx.fillStyle = traceColorFromConfidence(clamp((state.lastTargetStrength - gate) / Math.max(1e-6, 1 - gate), 0, 1));
    gctx.beginPath();
    gctx.arc(tp.x, tp.y, 6 * s, 0, Math.PI * 2);
    gctx.fill();
    gctx.fillStyle = "#eaeaea";
    gctx.font = `${11 * s}px system-ui`;
    gctx.fillText(`Target ${state.lastTargetRange.toFixed(2)}m @ ${state.lastTargetAngle.toFixed(0)}\u00b0`, tp.x + 8 * s, tp.y - 10 * s);
  }

  const spacingNow = Math.abs(model.spR.u - model.spL.u);
  gctx.fillStyle = "#bdbdbd";
  gctx.font = `${12 * s}px system-ui`;
  gctx.fillText(`Geometry view (${axisLabel}-axis steering: ${axisDirs[0]} \u2194 ${axisDirs[1]})`, 12 * s, 16 * s);
  gctx.fillText(`Spacing d=${spacingNow.toFixed(2)}m | Calib=${state.calib.valid ? "on" : "off"}${state.geomWizard.active ? " | wizard=edit" : ""}`, 12 * s, h - 8 * s);
}

function pointerToCanvasPx(ev, canvas) {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / Math.max(1, rect.width);
  const sy = canvas.height / Math.max(1, rect.height);
  return {
    x: (ev.clientX - rect.left) * sx,
    y: (ev.clientY - rect.top) * sy
  };
}

export function geometryPointerDown(ev) {
  if (!state.geomWizard.active) return;
  ensureGeometryWizardHandlesInitialized(false);
  const geometryCanvas = el("geometry");
  const minR = parseFloat(el("minR").value);
  const maxR = parseFloat(el("maxR").value);
  const frame = getGeometryFrame(state.geomWizard.handles, minR, maxR);
  const p = pointerToCanvasPx(ev, geometryCanvas);

  const hp = {
    spL: frame.toPx(state.geomWizard.handles.spL.u, state.geomWizard.handles.spL.f),
    spR: frame.toPx(state.geomWizard.handles.spR.u, state.geomWizard.handles.spR.f),
    mic: frame.toPx(state.geomWizard.handles.mic.u, state.geomWizard.handles.mic.f)
  };

  let bestName = null;
  let bestDist2 = Infinity;
  for (const name of ["spL", "spR", "mic"]) {
    const dx = p.x - hp[name].x;
    const dy = p.y - hp[name].y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist2) { bestDist2 = d2; bestName = name; }
  }

  const pickR = 14 * frame.s;
  if (bestName && bestDist2 <= pickR * pickR) {
    state.geomWizard.dragging = bestName;
    geometryCanvas.setPointerCapture(ev.pointerId);
    ev.preventDefault();
    drawGeometry(minR, maxR);
  }
}

export function geometryPointerMove(ev) {
  if (!state.geomWizard.active || !state.geomWizard.dragging) return;
  const minR = parseFloat(el("minR").value);
  const maxR = parseFloat(el("maxR").value);
  const geometryCanvas = el("geometry");
  const frame = getGeometryFrame(state.geomWizard.handles, minR, maxR);
  const p = pointerToCanvasPx(ev, geometryCanvas);
  const model = frame.fromPx(p.x, p.y);

  if (state.geomWizard.dragging === "spL") {
    state.geomWizard.handles.spL.u = model.u;
    state.geomWizard.handles.spL.f = 0;
  } else if (state.geomWizard.dragging === "spR") {
    state.geomWizard.handles.spR.u = model.u;
    state.geomWizard.handles.spR.f = 0;
  } else {
    state.geomWizard.handles.mic.u = model.u;
    state.geomWizard.handles.mic.f = Math.max(0, model.f);
  }

  if (state.geomWizard.handles.spL.u > state.geomWizard.handles.spR.u) {
    const t = state.geomWizard.handles.spL.u;
    state.geomWizard.handles.spL.u = state.geomWizard.handles.spR.u;
    state.geomWizard.handles.spR.u = t;
    if (state.geomWizard.dragging === "spL") state.geomWizard.dragging = "spR";
    else if (state.geomWizard.dragging === "spR") state.geomWizard.dragging = "spL";
  }

  state.geomWizard.touched = true;
  setGeomWizardStatus("Drag handles, then Apply geometry.");
  drawGeometry(minR, maxR);
  ev.preventDefault();
}

export function geometryPointerUp(ev) {
  if (state.geomWizard.dragging) {
    state.geomWizard.dragging = null;
    const geometryCanvas = el("geometry");
    if (geometryCanvas.hasPointerCapture(ev.pointerId)) geometryCanvas.releasePointerCapture(ev.pointerId);
    const minR = parseFloat(el("minR").value);
    const maxR = parseFloat(el("maxR").value);
    drawGeometry(minR, maxR);
  }
}
