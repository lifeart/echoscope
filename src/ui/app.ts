import { store } from '../core/store.js';
import { bus } from '../core/event-bus.js';
import { initAudio, resumeIfSuspended } from '../audio/engine.js';
import { doPing } from '../scan/ping-cycle.js';
import { doScan, stopScan } from '../scan/scan-engine.js';
import { calibrateRefinedWithSanity } from '../calibration/engine.js';
import { refreshDeviceInfo } from './device-info.js';
import { readConfigFromDOM, syncModeUI, setButtonStates } from './controls.js';
import { setStatus, log, updateDirectionReadout, updateBestReadout, renderCalibInfo } from './readouts.js';
import { detectDevice, applyDevicePreset } from './device-presets.js';
import { setupGeometryPointerHandlers, ensureGeometryWizardHandlesInitialized, resetGeometryWizardHandles, applyGeometryWizard, setGeomWizardStatus, syncGeometryWizardControls } from './geometry-wizard.js';
import { drawProfile, drawProfilePlaceholder } from '../viz/profile-plot.js';
import { drawHeatmap } from '../viz/heatmap-plot.js';
import { drawGeometry } from '../viz/geometry-plot.js';
import { drawCalibSanityPlot, drawSanityPlaceholder } from '../viz/sanity-plot.js';
import { resizeCanvasForDPR } from '../viz/renderer.js';
import { createHeatmap } from '../scan/heatmap-data.js';
import { DEFAULT_HEAT_BINS, DEVICE_PRESETS } from '../constants.js';

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function applyRetinaCanvases(): boolean {
  const ids = ['profile', 'heatmap', 'calibPlot', 'geometry'];
  let changed = false;
  for (const id of ids) {
    const canvas = el(id) as HTMLCanvasElement | null;
    if (canvas && resizeCanvasForDPR(canvas)) changed = true;
  }
  return changed;
}

function redrawAllCanvases(): void {
  const state = store.get();
  const lp = state.lastProfile;

  if (lp.corr && lp.corr.length) {
    drawProfile(lp.corr, lp.tau0, lp.c, lp.minR, lp.maxR);
  } else {
    drawProfilePlaceholder();
  }

  drawHeatmap(state.config.minRange, state.config.maxRange);
  drawGeometry(state.config.minRange, state.config.maxRange);

  const calib = state.calibration;
  if (calib?.sanity.have && calib.sanity.curveL && calib.sanity.curveR) {
    drawCalibSanityPlot(calib.sanity.curveL, calib.sanity.peakIndexL, calib.sanity.curveR, calib.sanity.peakIndexR, calib.sanity.earlyMs);
  } else {
    drawSanityPlaceholder();
  }
}

export function initApp(): void {
  // Mode UI
  el('mode')?.addEventListener('change', () => { syncModeUI(); readConfigFromDOM(); });
  syncModeUI();

  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Angle slider
  el('angle')?.addEventListener('input', () => {
    const angleEl = el('angle') as HTMLInputElement;
    const angleValEl = el('angleVal');
    if (angleValEl) angleValEl.textContent = angleEl.value;
    readConfigFromDOM();
    drawGeometry(store.get().config.minRange, store.get().config.maxRange);
  });

  // Geometry canvas
  setupGeometryPointerHandlers();

  // Button wiring
  el('btnInit')?.addEventListener('click', async () => {
    try {
      setStatus('initializing');
      readConfigFromDOM();
      await initAudio();
      setButtonStates(true, false);
      renderCalibInfo();
      await refreshDeviceInfo();
      log(`[ok] audio initialized: sr=${store.get().audio.actualSampleRate} Hz, capture=${store.get().audio.captureMethod}`);
      setStatus('ready');
    } catch (e: any) {
      setStatus('error');
      log('[err] init failed: ' + (e?.message || e));
    }
  });

  el('btnPing')?.addEventListener('click', async () => {
    try {
      readConfigFromDOM();
      setStatus('pinging');
      await doPing(store.get().config.steeringAngleDeg, null);
      updateBestReadout();
      updateDirectionReadout();
      setStatus('ready');
    } catch (e: any) {
      setStatus('error');
      log('[err] ping failed: ' + (e?.message || e));
    }
  });

  el('btnScan')?.addEventListener('click', async () => {
    try {
      readConfigFromDOM();
      setButtonStates(true, true);
      await doScan();
      updateBestReadout();
      updateDirectionReadout();
      setButtonStates(true, false);
    } catch (e: any) {
      setStatus('error');
      log('[err] scan failed: ' + (e?.message || e));
      stopScan();
      setButtonStates(true, false);
    }
  });

  el('btnStop')?.addEventListener('click', () => {
    stopScan();
    setButtonStates(true, false);
  });

  el('btnCalibrate')?.addEventListener('click', async () => {
    try {
      readConfigFromDOM();
      await calibrateRefinedWithSanity();
      renderCalibInfo();
      const calib = store.get().calibration;
      if (calib?.sanity.have && calib.sanity.curveL && calib.sanity.curveR) {
        drawCalibSanityPlot(calib.sanity.curveL, calib.sanity.peakIndexL, calib.sanity.curveR, calib.sanity.peakIndexR, calib.sanity.earlyMs);
        const sanityDetails = el('sanityDetails') as HTMLDetailsElement | null;
        if (sanityDetails) sanityDetails.open = true;
      }
      drawGeometry(store.get().config.minRange, store.get().config.maxRange);
    } catch (e: any) {
      setStatus('error');
      log('[err] calibrate failed: ' + (e?.message || e));
      renderCalibInfo();
    }
  });

  el('btnRefreshDevices')?.addEventListener('click', async () => {
    try { await refreshDeviceInfo(); }
    catch (e: any) { log('[err] refresh devices failed: ' + (e?.message || e)); }
  });

  // Device preset
  el('devicePreset')?.addEventListener('change', () => {
    const key = (el('devicePreset') as HTMLSelectElement).value;
    applyDevicePreset(key);
    ensureGeometryWizardHandlesInitialized(true);
    drawGeometry(store.get().config.minRange, store.get().config.maxRange);
  });

  // Geometry wizard
  el('geomWizardOn')?.addEventListener('change', () => {
    const checked = (el('geomWizardOn') as HTMLInputElement).checked;
    store.update(s => {
      s.geomWizard.active = checked;
      s.geomWizard.dragging = null;
    });
    if (checked) {
      ensureGeometryWizardHandlesInitialized(true);
      setGeomWizardStatus('Drag handles on geometry view, then Apply geometry.');
    } else {
      setGeomWizardStatus('Enable wizard to drag speakers/mic on geometry view.');
    }
    syncGeometryWizardControls();
    drawGeometry(store.get().config.minRange, store.get().config.maxRange);
  });

  el('btnGeomReset')?.addEventListener('click', () => {
    if (!store.get().geomWizard.active) return;
    resetGeometryWizardHandles();
  });

  el('btnGeomApply')?.addEventListener('click', () => {
    if (!store.get().geomWizard.active) return;
    applyGeometryWizard();
  });

  // Trace & direction
  el('showTrace')?.addEventListener('change', () => {
    drawHeatmap(store.get().config.minRange, store.get().config.maxRange);
  });

  el('dirAxis')?.addEventListener('change', () => {
    readConfigFromDOM();
    updateDirectionReadout();
    drawGeometry(store.get().config.minRange, store.get().config.maxRange);
  });

  el('useCalib')?.addEventListener('change', () => {
    readConfigFromDOM();
    renderCalibInfo();
  });

  // Resize
  window.addEventListener('resize', () => {
    if (applyRetinaCanvases()) redrawAllCanvases();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resumeIfSuspended().catch(() => {});
  });

  // Subscribe to events for auto-redraw
  bus.on('ping:complete', () => {
    const state = store.get();
    const lp = state.lastProfile;
    if (lp.corr) drawProfile(lp.corr, lp.tau0, lp.c, lp.minR, lp.maxR);
    drawHeatmap(state.config.minRange, state.config.maxRange);
    drawGeometry(state.config.minRange, state.config.maxRange);
    updateBestReadout();
    updateDirectionReadout();
  });

  // Initial render
  setStatus('idle');
  syncGeometryWizardControls();
  applyRetinaCanvases();
  drawProfilePlaceholder();

  const savedPreset = localStorage.getItem('echoscope:devicePreset');
  const deviceKey = (savedPreset && DEVICE_PRESETS[savedPreset]) ? savedPreset : detectDevice();
  applyDevicePreset(deviceKey, true);
  log(`[init] device: ${deviceKey}${savedPreset === deviceKey ? ' (saved)' : ''}`);

  const defaultAngles = [-60, -50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50, 60];
  store.set('heatmap', createHeatmap(defaultAngles, DEFAULT_HEAT_BINS));

  const config = store.get().config;
  drawHeatmap(config.minRange, config.maxRange);
  drawGeometry(config.minRange, config.maxRange);
  drawSanityPlaceholder();

  refreshDeviceInfo().catch(() => {});
  renderCalibInfo();
}
