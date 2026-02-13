import { store } from '../core/store.js';
import { log } from './readouts.js';
import { renderCalibInfo } from './readouts.js';
import { drawGeometry, getGeometryModelFromCurrent, getGeometryFrame } from '../viz/geometry-plot.js';
import { canvasPixelScale } from '../viz/renderer.js';

export function setGeomWizardStatus(msg: string): void {
  const el = document.getElementById('geomWizardStatus');
  if (el) el.textContent = msg;
}

export function syncGeometryWizardControls(): void {
  const state = store.get();
  const en = state.geomWizard.active;
  const wizardToggle = document.getElementById('geomWizardOn') as HTMLInputElement | null;
  const btnReset = document.getElementById('btnGeomReset') as HTMLButtonElement | null;
  const btnApply = document.getElementById('btnGeomApply') as HTMLButtonElement | null;
  if (wizardToggle) wizardToggle.checked = en;
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
      // geometryError now holds deltaConsistency (TDOA metric) — keep it
      // unchanged since the wizard only adjusts visual geometry, not the
      // underlying per-repeat TDOA measurements.
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

    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / Math.max(1, rect.width);
    const sy = canvas.height / Math.max(1, rect.height);
    const px = (ev.clientX - rect.left) * sx;
    const py = (ev.clientY - rect.top) * sy;

    const s = canvasPixelScale(canvas);
    const handles = state.geomWizard.handles;
    const config = state.config;
    const frame = getGeometryFrame(handles, config.minRange, config.maxRange, canvas);
    const pickR = 14 * s;

    let bestName: string | null = null;
    let bestDist2 = Infinity;

    for (const name of ['spL', 'spR', 'mic'] as const) {
      const handle = handles[name];
      const hp = frame.toPx(handle.u, handle.f);
      const dx = px - hp.x;
      const dy = py - hp.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist2) { bestDist2 = d2; bestName = name; }
    }

    if (bestName && bestDist2 <= pickR * pickR) {
      store.set('geomWizard.dragging', bestName);
      canvas.setPointerCapture(ev.pointerId);
      ev.preventDefault();
      drawGeometry(config.minRange, config.maxRange);
    }
  });

  canvas.addEventListener('pointermove', (ev) => {
    const state = store.get();
    const dragging = state.geomWizard.dragging;
    if (!state.geomWizard.active || !dragging) return;
    ev.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / Math.max(1, rect.width);
    const sy = canvas.height / Math.max(1, rect.height);
    const px = (ev.clientX - rect.left) * sx;
    const py = (ev.clientY - rect.top) * sy;

    const config = state.config;
    const frame = getGeometryFrame(state.geomWizard.handles, config.minRange, config.maxRange, canvas);
    const pos = frame.fromPx(px, py);

    store.update(s => {
      const h = s.geomWizard.handles[dragging as 'spL' | 'spR' | 'mic'];
      h.u = pos.u;
      // Speakers stay on baseline (f=0)
      h.f = (dragging === 'spL' || dragging === 'spR') ? 0 : pos.f;
      s.geomWizard.touched = true;
    });

    setGeomWizardStatus('Drag handles, then Apply geometry.');
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
