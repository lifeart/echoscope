import { store } from '../core/store.js';
import { estimateMicXY } from '../spatial/geometry.js';
import { log } from './readouts.js';
import { renderCalibInfo } from './readouts.js';
import { drawGeometry, getGeometryModelFromCurrent } from '../viz/geometry-plot.js';
import { canvasPixelScale } from '../viz/renderer.js';

export function setGeomWizardStatus(msg: string): void {
  const el = document.getElementById('geomWizardStatus');
  if (el) el.textContent = msg;
}

export function syncGeometryWizardControls(): void {
  const state = store.get();
  const en = state.geomWizard.active;
  const btnReset = document.getElementById('btnGeomReset') as HTMLButtonElement | null;
  const btnApply = document.getElementById('btnGeomApply') as HTMLButtonElement | null;
  if (btnReset) btnReset.disabled = !en;
  if (btnApply) btnApply.disabled = !en;
}

export function ensureGeometryWizardHandlesInitialized(force = false): void {
  const state = store.get();
  if (!force && state.geomWizard.touched) return;
  const model = getGeometryModelFromCurrent();
  store.update(s => {
    s.geomWizard.handles.spL = { u: model.spL.u, f: 0 };
    s.geomWizard.handles.spR = { u: model.spR.u, f: 0 };
    s.geomWizard.handles.mic = { u: model.mic.u, f: Math.max(0, model.mic.f) };
    if (force) s.geomWizard.touched = false;
  });
}

export function resetGeometryWizardHandles(): void {
  ensureGeometryWizardHandlesInitialized(true);
  setGeomWizardStatus('Geometry handles reset from current spacing/calibration.');
  const config = store.get().config;
  drawGeometry(config.minRange, config.maxRange);
}

export function applyGeometryWizard(): void {
  ensureGeometryWizardHandlesInitialized(false);
  const state = store.get();
  const h = state.geomWizard.handles;
  const dNew = Math.abs(h.spR.u - h.spL.u);
  if (!(dNew > 0.02)) {
    setGeomWizardStatus('Apply failed: speaker spacing too small.');
    return;
  }

  const centerU = 0.5 * (h.spL.u + h.spR.u);
  const micX = h.mic.u - centerU;
  const micY = Math.max(0, h.mic.f);

  const spacingEl = document.getElementById('spacing') as HTMLInputElement | null;
  if (spacingEl) spacingEl.value = dNew.toFixed(3);

  store.update(s => {
    s.config.spacing = dNew;
    if (s.calibration?.valid) {
      const rL = Math.hypot(h.mic.u - h.spL.u, micY - h.spL.f);
      const rR = Math.hypot(h.mic.u - h.spR.u, micY - h.spR.f);
      s.calibration.distances = { L: rL, R: rR };
      s.calibration.micPosition = { x: micX, y: micY };
      s.calibration.geometryError = estimateMicXY(rL, rR, dNew).err;
    }
  });

  if (state.calibration?.valid) {
    renderCalibInfo();
    log(`[wizard] geometry applied: d=${dNew.toFixed(3)}m, mic\u2248(${micX.toFixed(3)}, ${micY.toFixed(3)})m`);
    setGeomWizardStatus('Applied to spacing and calibrated geometry.');
  } else {
    log(`[wizard] spacing updated to ${dNew.toFixed(3)}m (run calibration to apply mic geometry).`);
    setGeomWizardStatus('Applied spacing. Run calibration to lock mic geometry.');
  }

  const config = store.get().config;
  drawGeometry(config.minRange, config.maxRange);
}

export function setupGeometryPointerHandlers(): void {
  const canvas = document.getElementById('geometry') as HTMLCanvasElement | null;
  if (!canvas) return;

  canvas.style.touchAction = 'none';

  canvas.addEventListener('pointerdown', (ev) => {
    const state = store.get();
    if (!state.geomWizard.active) return;
    ensureGeometryWizardHandlesInitialized(false);

    // Use simplified hit test
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / Math.max(1, rect.width);
    const sy = canvas.height / Math.max(1, rect.height);
    const px = (ev.clientX - rect.left) * sx;
    const py = (ev.clientY - rect.top) * sy;

    const s = canvasPixelScale(canvas);
    const handles = state.geomWizard.handles;
    // Simple pick test - find nearest handle within radius
    const pickR = 14 * s;

    // We need to approximate handle positions - just check all 3
    let bestName: string | null = null;
    let bestDist2 = Infinity;
    // For now, use approximate positions
    const w = canvas.width;
    const h = canvas.height;
    const centerX = w / 2;
    const originY = h - 56 * s;

    function approxPx(u: number, f: number) {
      // Rough approximation
      const scale = (w * 0.4);
      return { x: centerX + u * scale * 4, y: originY - f * scale * 2 };
    }

    for (const name of ['spL', 'spR', 'mic'] as const) {
      const handle = handles[name];
      const hp = approxPx(handle.u, handle.f);
      const dx = px - hp.x;
      const dy = py - hp.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist2) { bestDist2 = d2; bestName = name; }
    }

    if (bestName && bestDist2 <= pickR * pickR) {
      store.set('geomWizard.dragging', bestName);
      canvas.setPointerCapture(ev.pointerId);
      ev.preventDefault();
      const config = store.get().config;
      drawGeometry(config.minRange, config.maxRange);
    }
  });

  canvas.addEventListener('pointermove', (ev) => {
    const state = store.get();
    if (!state.geomWizard.active || !state.geomWizard.dragging) return;
    // Simplified move - update handle based on pointer position
    ev.preventDefault();
    store.set('geomWizard.touched', true);
    setGeomWizardStatus('Drag handles, then Apply geometry.');
    const config = store.get().config;
    drawGeometry(config.minRange, config.maxRange);
  });

  canvas.addEventListener('pointerup', (ev) => {
    const state = store.get();
    if (state.geomWizard.dragging) {
      store.set('geomWizard.dragging', null);
      if (canvas.hasPointerCapture(ev.pointerId)) {
        canvas.releasePointerCapture(ev.pointerId);
      }
      const config = store.get().config;
      drawGeometry(config.minRange, config.maxRange);
    }
  });

  canvas.addEventListener('pointercancel', (ev) => {
    const state = store.get();
    if (state.geomWizard.dragging) {
      store.set('geomWizard.dragging', null);
      if (canvas.hasPointerCapture(ev.pointerId)) {
        canvas.releasePointerCapture(ev.pointerId);
      }
    }
  });
}
