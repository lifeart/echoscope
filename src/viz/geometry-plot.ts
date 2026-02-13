import { clamp } from '../utils.js';
import { store } from '../core/store.js';
import { clearCanvas, canvasPixelScale } from './renderer.js';
import { traceColorFromConfidence } from './colors.js';
import { positionCovarianceUF, covarianceToEllipse, drawEllipse } from './uncertainty-ellipse.js';

interface TrailPoint {
  u: number;
  f: number;
}

const trackTrails = new Map<number, TrailPoint[]>();

function trackToUF(track: { position: { range: number; angleDeg: number } }, baselineCenterU: number): TrailPoint | null {
  const { range, angleDeg } = track.position;
  if (!(Number.isFinite(range) && range >= 0 && Number.isFinite(angleDeg))) return null;
  const u = baselineCenterU + range * Math.sin(angleDeg * Math.PI / 180);
  const f = Math.max(0, range * Math.cos(angleDeg * Math.PI / 180));
  return { u, f };
}

function updateTrackTrails(
  targets: Array<{ id: number; position: { range: number; angleDeg: number } }>,
  baselineCenterU: number,
  trailMaxPoints: number,
): void {
  const activeIds = new Set<number>();

  for (const track of targets) {
    const p = trackToUF(track, baselineCenterU);
    if (!p) continue;

    activeIds.add(track.id);
    const trail = trackTrails.get(track.id) ?? [];
    const prev = trail[trail.length - 1];
    if (!prev || Math.hypot(prev.u - p.u, prev.f - p.f) > 1e-3) trail.push(p);
    while (trail.length > trailMaxPoints) trail.shift();
    trackTrails.set(track.id, trail);
  }

  const staleIds: number[] = [];
  for (const id of trackTrails.keys()) {
    if (!activeIds.has(id)) staleIds.push(id);
  }
  for (const id of staleIds) trackTrails.delete(id);
}

function shouldRenderTrack(
  track: { confidence: number; missCount: number },
  strengthGate: number,
  minConfidenceFloor: number,
  fadeMissCount: number,
): boolean {
  const confidenceGate = Math.max(minConfidenceFloor, strengthGate);
  if (!(Number.isFinite(track.confidence) && track.confidence > confidenceGate)) return false;
  if (!(Number.isFinite(track.missCount) && track.missCount >= 0 && track.missCount < fadeMissCount)) return false;
  return true;
}

interface GeomModel {
  spL: { u: number; f: number };
  spR: { u: number; f: number };
  mic: { u: number; f: number };
}

function getGeometryModelFromCurrent(): GeomModel {
  const state = store.get();
  const d = state.config.spacing;
  const halfD = (Number.isFinite(d) && d > 0.02) ? (d / 2) : 0.1;
  const calib = state.calibration;

  const micU = (calib?.valid && Number.isFinite(calib.micPosition.x)) ? calib.micPosition.x
    : (state.presetMicPosition.x !== null ? state.presetMicPosition.x : 0);
  const micF = (calib?.valid && Number.isFinite(calib.micPosition.y) && calib.micPosition.y >= 0) ? calib.micPosition.y
    : (state.presetMicPosition.y !== null ? state.presetMicPosition.y : 0.12);

  return {
    spL: { u: -halfD, f: 0 },
    spR: { u: halfD, f: 0 },
    mic: { u: micU, f: Math.max(0, micF) },
  };
}

function getGeometryFrame(model: GeomModel, minR: number, maxR: number, canvas: HTMLCanvasElement) {
  const state = store.get();
  const w = canvas.width;
  const h = canvas.height;
  const s = canvasPixelScale(canvas);
  const left = 34 * s;
  const right = w - 24 * s;
  const top = 20 * s;
  const bottom = h - 26 * s;
  const originY = bottom - 30 * s;
  const centerX = 0.5 * (left + right);
  const maxRange = (Number.isFinite(maxR) && maxR > 0.2) ? maxR : 4.0;
  const yMax = Math.max(maxRange * 1.10, (Number.isFinite(minR) ? minR : 0.3) + 0.4);

  const baseULimit = Math.max(Math.abs(model.spL.u), Math.abs(model.spR.u), Math.abs(model.mic.u), 0.22) * 1.35;
  let uLimit = baseULimit;

  if (state.scanning) {
    // During scanning, use stable scale based on full scan extent (±60°)
    // so speakers don't appear to jump as the target moves across angles
    const maxScanExtent = maxRange * Math.sin(60 * Math.PI / 180);
    uLimit = Math.max(uLimit, maxScanExtent * 1.25);
  } else if (Number.isFinite(state.lastTarget.angle) && Number.isFinite(state.lastTarget.range)) {
    const tu = state.lastTarget.range * Math.sin(state.lastTarget.angle * Math.PI / 180);
    uLimit = Math.max(uLimit, Math.abs(tu) * 1.25);
  }

  function toPx(u: number, fwd: number) {
    const x = centerX + (u / Math.max(1e-6, uLimit)) * ((right - left) * 0.48);
    const y = originY - (fwd / Math.max(1e-6, yMax)) * (originY - top);
    return { x, y };
  }

  function fromPx(x: number, y: number) {
    const u = ((x - centerX) / Math.max(1e-6, (right - left) * 0.48)) * uLimit;
    const f = ((originY - y) / Math.max(1e-6, originY - top)) * yMax;
    return { u, f: Math.max(0, f) };
  }

  return { w, h, s, left, right, top, bottom, originY, centerX, yMax, uLimit, toPx, fromPx };
}

export function drawGeometry(minR: number, maxR: number): void {
  const canvas = document.getElementById('geometry') as HTMLCanvasElement | null;
  if (!canvas) return;
  const gctx = canvas.getContext('2d');
  if (!gctx) return;

  const state = store.get();
  const wizard = state.geomWizard;

  const model = wizard.active ? wizard.handles : getGeometryModelFromCurrent();
  const frame = getGeometryFrame(model, minR, maxR, canvas);
  const { w, h, s, left, right, top, originY, centerX, toPx } = frame;

  clearCanvas(gctx, w, h);

  const dirAxis = state.config.directionAxis;
  const axisLabel = dirAxis === 'vertical' ? 'Z' : 'X';
  const axisDirs = dirAxis === 'vertical' ? ['Bottom', 'Top'] : ['Left', 'Right'];

  // Center axis
  gctx.strokeStyle = '#2f2f2f';
  gctx.lineWidth = 1 * s;
  gctx.beginPath();
  gctx.moveTo(centerX, top);
  gctx.lineTo(centerX, originY);
  gctx.stroke();

  // Baseline
  gctx.strokeStyle = '#3a3a3a';
  gctx.beginPath();
  gctx.moveTo(left, originY);
  gctx.lineTo(right, originY);
  gctx.stroke();

  const spLP = toPx(model.spL.u, 0);
  const spRP = toPx(model.spR.u, 0);
  const micP = toPx(model.mic.u, Math.max(0, model.mic.f));

  // Speaker baseline
  gctx.strokeStyle = '#6f6f6f';
  gctx.lineWidth = 2 * s;
  gctx.beginPath();
  gctx.moveTo(spLP.x, spLP.y);
  gctx.lineTo(spRP.x, spRP.y);
  gctx.stroke();

  // Draw nodes
  function drawNode(p: { x: number; y: number }, color: string, rPx: number, label: string, selected = false) {
    gctx!.fillStyle = color;
    gctx!.beginPath();
    gctx!.arc(p.x, p.y, rPx, 0, Math.PI * 2);
    gctx!.fill();
    if (selected) {
      gctx!.strokeStyle = '#f5f5f5';
      gctx!.lineWidth = 1.2 * s;
      gctx!.beginPath();
      gctx!.arc(p.x, p.y, rPx + 3 * s, 0, Math.PI * 2);
      gctx!.stroke();
    }
    gctx!.fillStyle = '#d8d8d8';
    gctx!.font = `${11 * s}px system-ui`;
    gctx!.fillText(label, p.x + 7 * s, p.y - 7 * s);
  }

  drawNode(spLP, '#8dd0ff', 5 * s, 'Speaker L', wizard.dragging === 'spL');
  drawNode(spRP, '#8dd0ff', 5 * s, 'Speaker R', wizard.dragging === 'spR');
  drawNode(micP, state.calibration?.valid ? '#ffbf80' : '#8a8a8a', 5 * s, 'Mic', wizard.dragging === 'mic');

  // Wizard guide line
  if (wizard.active) {
    gctx.strokeStyle = 'rgba(255,255,255,0.22)';
    gctx.setLineDash([4 * s, 4 * s]);
    gctx.beginPath();
    gctx.moveTo(micP.x, originY);
    gctx.lineTo(micP.x, micP.y);
    gctx.stroke();
    gctx.setLineDash([]);
  }

  // Steering ray
  const baselineCenterU = 0.5 * (model.spL.u + model.spR.u);
  const steerDeg = state.config.steeringAngleDeg;
  const steerU = baselineCenterU + frame.yMax * Math.sin(steerDeg * Math.PI / 180);
  const steerF = frame.yMax * Math.cos(steerDeg * Math.PI / 180);
  const steerOrigin = toPx(baselineCenterU, 0);
  const steerEnd = toPx(steerU, Math.max(0, steerF));

  gctx.strokeStyle = 'rgba(160,210,255,0.85)';
  gctx.lineWidth = 1.5 * s;
  gctx.setLineDash([5 * s, 5 * s]);
  gctx.beginPath();
  gctx.moveTo(steerOrigin.x, steerOrigin.y);
  gctx.lineTo(steerEnd.x, steerEnd.y);
  gctx.stroke();
  gctx.setLineDash([]);

  const vizCfg = state.config.trackViz;
  const trailMaxPoints = Math.floor(clamp(vizCfg.trailMaxPoints, 4, 80));
  const fadeMissCount = Math.floor(clamp(vizCfg.fadeMissCount, 1, 60));
  const minConfidenceFloor = clamp(vizCfg.minConfidenceFloor, 0, 1);
  const trailMinAlpha = clamp(vizCfg.trailMinAlpha, 0, 1);
  const trailMaxAlpha = Math.max(trailMinAlpha, clamp(vizCfg.trailMaxAlpha, 0, 1));

  const gate = state.config.strengthGate;
  const visibleTracks = state.targets.filter(track => shouldRenderTrack(track, gate, minConfidenceFloor, fadeMissCount));

  updateTrackTrails(state.targets, baselineCenterU, trailMaxPoints);

  for (const track of visibleTracks) {
    const p = trackToUF(track, baselineCenterU);
    if (!p) continue;

    const tp = toPx(p.u, p.f);
    const conf = clamp(track.confidence, 0, 1);
    const color = traceColorFromConfidence(conf);
    const trail = trackTrails.get(track.id);
    const freshness = clamp(1 - track.missCount / Math.max(1, fadeMissCount), 0.2, 1);

    if (trail && trail.length > 1) {
      gctx.strokeStyle = color;
      for (let i = 1; i < trail.length; i++) {
        const p0 = toPx(trail[i - 1].u, trail[i - 1].f);
        const p1 = toPx(trail[i].u, trail[i].f);
        const frac = i / Math.max(1, trail.length - 1);
        const alpha = clamp((trailMinAlpha + (trailMaxAlpha - trailMinAlpha) * frac) * freshness, 0, 1);
        gctx.globalAlpha = alpha;
        gctx.lineWidth = (1.0 + 0.8 * frac) * s;
        gctx.beginPath();
        gctx.moveTo(p0.x, p0.y);
        gctx.lineTo(p1.x, p1.y);
        gctx.stroke();
      }
      gctx.globalAlpha = 1;
    }

    gctx.fillStyle = color;
    gctx.globalAlpha = 0.55 + 0.45 * freshness;
    gctx.beginPath();
    gctx.arc(tp.x, tp.y, (4.2 + 1.1 * freshness) * s, 0, Math.PI * 2);
    gctx.fill();
    gctx.globalAlpha = 1;

    // Uncertainty ellipse
    if (track.covariance && track.covariance.length >= 8) {
      const covUF = positionCovarianceUF(track.position.range, track.position.angleDeg, track.covariance);

      const originPx = toPx(0, 0);
      const unitPx = toPx(1, 1);
      const pxPerMeterU = Math.abs(unitPx.x - originPx.x);
      const pxPerMeterF = Math.abs(originPx.y - unitPx.y);

      // Scale covariance to pixel space, then decompose
      const sigUUpx = covUF.sigUU * pxPerMeterU * pxPerMeterU;
      const sigFFpx = covUF.sigFF * pxPerMeterF * pxPerMeterF;
      const sigUFpx = covUF.sigUF * pxPerMeterU * pxPerMeterF;
      const ellipsePx = covarianceToEllipse(sigUUpx, sigFFpx, sigUFpx, 2.146);

      drawEllipse(gctx, {
        cx: tp.x, cy: tp.y,
        semiMajorPx: clamp(ellipsePx.semiMajor, 0, 200),
        semiMinorPx: clamp(ellipsePx.semiMinor, 0, 200),
        rotationRad: ellipsePx.rotationRad,
      }, color, 1.5 * s);
    }

    gctx.fillStyle = '#eaeaea';
    gctx.font = `${10 * s}px system-ui`;
    gctx.fillText(`T${track.id}`, tp.x + 7 * s, tp.y - 8 * s);
  }

  const target = state.lastTarget;
  if (visibleTracks.length === 0 && Number.isFinite(target.angle) && Number.isFinite(target.range) && target.strength > gate) {
    const targetU = baselineCenterU + target.range * Math.sin(target.angle * Math.PI / 180);
    const targetF = Math.max(0, target.range * Math.cos(target.angle * Math.PI / 180));
    const tp = toPx(targetU, targetF);
    gctx.fillStyle = traceColorFromConfidence(clamp((target.strength - gate) / Math.max(1e-6, 1 - gate), 0, 1));
    gctx.beginPath();
    gctx.arc(tp.x, tp.y, 6 * s, 0, Math.PI * 2);
    gctx.fill();
    gctx.fillStyle = '#eaeaea';
    gctx.font = `${11 * s}px system-ui`;
    gctx.fillText(`Target ${target.range.toFixed(2)}m @ ${target.angle.toFixed(0)}\u00b0`, tp.x + 8 * s, tp.y - 10 * s);
  }

  // Labels
  const spacingNow = Math.abs(model.spR.u - model.spL.u);
  gctx.fillStyle = '#bdbdbd';
  gctx.font = `${12 * s}px system-ui`;
  gctx.fillText(`Geometry view (${axisLabel}-axis steering: ${axisDirs[0]} \u2194 ${axisDirs[1]})`, 12 * s, 16 * s);
  gctx.fillText(`Spacing d=${spacingNow.toFixed(2)}m | Calib=${state.calibration?.valid ? 'on' : 'off'} | Tracks=${visibleTracks.length}/${state.targets.length}${wizard.active ? ' | wizard=edit' : ''}`, 12 * s, h - 8 * s);
}

// Export geometry frame helpers for the geometry wizard
export { getGeometryModelFromCurrent, getGeometryFrame };
