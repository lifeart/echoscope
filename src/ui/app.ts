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
import { drawProfile, drawProfilePlaceholder, setProfileMouse } from '../viz/profile-plot.js';
import { drawHeatmap, setHeatmapMouse, redrawHeatmapCrosshair } from '../viz/heatmap-plot.js';
import { drawGeometry } from '../viz/geometry-plot.js';
import { drawCalibSanityPlot, drawSanityPlaceholder } from '../viz/sanity-plot.js';
import { resizeCanvasForDPR } from '../viz/renderer.js';
import { createHeatmap, updateHeatmapRow } from '../scan/heatmap-data.js';
import { initLevelMeter } from '../viz/level-meter.js';
import { drawSignalPreview, scheduleSignalPreview } from '../viz/signal-preview.js';
import { DEFAULT_HEAT_BINS, DEVICE_PRESETS } from '../constants.js';

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function applyRetinaCanvases(): boolean {
  const ids = ['profile', 'heatmap', 'calibPlot', 'geometry', 'previewChirp', 'previewMls', 'previewGolay'];
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

  drawSignalPreview();
}

/* ---- canvas mouse → pixel coords ---- */
function canvasMousePos(canvas: HTMLCanvasElement, ev: MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / Math.max(1, rect.width);
  const sy = canvas.height / Math.max(1, rect.height);
  return { x: (ev.clientX - rect.left) * sx, y: (ev.clientY - rect.top) * sy };
}

/* ---- ping stats ---- */
let pingStartTime = 0;

export function initApp(): void {
  store.subscribe('status', (value) => {
    if (typeof value === 'string') setStatus(value);
  });

  // Mode UI
  el('mode')?.addEventListener('change', () => { syncModeUI(); readConfigFromDOM(); scheduleSignalPreview(); });
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
      const audioState = store.get().audio;
      log(`[ok] audio initialized: sr=${audioState.actualSampleRate} Hz, capture=${audioState.captureMethod}, channels=${audioState.channelCount}`);
      const stereoEl = el('stereoIndicator');
      if (stereoEl) {
        if (audioState.channelCount >= 2) {
          stereoEl.style.display = 'inline';
          stereoEl.textContent = `${audioState.channelCount}ch`;
        } else {
          stereoEl.style.display = 'none';
        }
      }
      setStatus('ready');
      initLevelMeter();
      drawSignalPreview();
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
      drawHeatmap(store.get().config.minRange, store.get().config.maxRange);
      drawGeometry(store.get().config.minRange, store.get().config.maxRange);
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
        const sanityDetails = el('sanityDetails') as HTMLDetailsElement | null;
        if (sanityDetails) sanityDetails.open = true;
        // Draw AFTER opening details so canvas has correct dimensions for DPR scaling
        drawCalibSanityPlot(calib.sanity.curveL, calib.sanity.peakIndexL, calib.sanity.curveR, calib.sanity.peakIndexR, calib.sanity.earlyMs);
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
    readConfigFromDOM(); // recompute derived values (minRange, scanDwell) after spacing change
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

  // Signal preview on param changes
  const paramInputIds = ['f1', 'f2', 'T', 'mlsOrder', 'chipRate', 'golayOrder', 'golayChipRate', 'golayGapMs'];
  for (const id of paramInputIds) {
    el(id)?.addEventListener('input', () => { readConfigFromDOM(); scheduleSignalPreview(); });
  }

  // Computed config inputs — update derived labels live
  const configInputIds = ['temperature', 'maxR', 'spacing'];
  for (const id of configInputIds) {
    el(id)?.addEventListener('input', () => { readConfigFromDOM(); });
  }

  // ---- Mouse crosshair wiring ----
  const profileCanvas = el('profile') as HTMLCanvasElement | null;
  if (profileCanvas) {
    profileCanvas.addEventListener('mousemove', (ev) => {
      setProfileMouse(canvasMousePos(profileCanvas, ev));
      const state = store.get();
      const lp = state.lastProfile;
      if (lp.corr && lp.corr.length) drawProfile(lp.corr, lp.tau0, lp.c, lp.minR, lp.maxR);
    });
    profileCanvas.addEventListener('mouseleave', () => {
      setProfileMouse(null);
      const state = store.get();
      const lp = state.lastProfile;
      if (lp.corr && lp.corr.length) drawProfile(lp.corr, lp.tau0, lp.c, lp.minR, lp.maxR);
    });
  }

  const heatmapCanvas = el('heatmap') as HTMLCanvasElement | null;
  if (heatmapCanvas) {
    heatmapCanvas.addEventListener('mousemove', (ev) => {
      setHeatmapMouse(canvasMousePos(heatmapCanvas, ev));
      redrawHeatmapCrosshair();
    });
    heatmapCanvas.addEventListener('mouseleave', () => {
      setHeatmapMouse(null);
      redrawHeatmapCrosshair();
    });
  }

  // ---- Keyboard shortcuts ----
  function clickIfEnabled(id: string): void {
    const btn = el(id) as HTMLButtonElement | null;
    if (btn && !btn.disabled) btn.click();
  }

  document.addEventListener('keydown', (ev) => {
    const tag = (ev.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    switch (ev.key) {
      case 'i':
      case 'I':
        clickIfEnabled('btnInit');
        break;
      case 'p':
      case 'P':
      case ' ':
        ev.preventDefault();
        clickIfEnabled('btnPing');
        break;
      case 's':
      case 'S':
        clickIfEnabled('btnScan');
        break;
      case 'Escape':
        clickIfEnabled('btnStop');
        break;
      case 'c':
      case 'C':
        clickIfEnabled('btnCalibrate');
        break;
    }
  });

  // ---- Scan progress bar ----
  bus.on('scan:step', ({ angleDeg, index, total, pass, totalPasses }) => {
    const progressEl = el('scanProgress');
    const textEl = el('scanProgressText');
    const fillEl = el('scanProgressFill');
    if (progressEl) progressEl.style.display = 'block';
    const passLabel = totalPasses > 1 ? ` pass ${pass + 1}/${totalPasses}` : '';
    if (textEl) textEl.textContent = `Scanning ${index + 1}/${total} (${angleDeg}\u00b0)${passLabel}`;
    const progress = totalPasses > 1
      ? (index * totalPasses + pass + 1) / (total * totalPasses)
      : (index + 1) / total;
    if (fillEl) fillEl.style.width = `${progress * 100}%`;
  });

  bus.on('scan:complete', () => {
    const progressEl = el('scanProgress');
    if (progressEl) progressEl.style.display = 'none';
  });

  // ---- Ping statistics ----
  bus.on('ping:start', () => {
    pingStartTime = performance.now();
  });

  bus.on('ping:complete', ({ angleDeg, profile }) => {
    console.log(`[ping:complete] angleDeg=${angleDeg} bestBin=${profile.bestBin} bestStrength=${profile.bestStrength.toExponential(3)} binsLen=${profile.bins.length}`);

    // Debug: log profile bins stats
    let bMin = Infinity, bMax = -Infinity, bNonZero = 0;
    for (let i = 0; i < profile.bins.length; i++) {
      if (profile.bins[i] < bMin) bMin = profile.bins[i];
      if (profile.bins[i] > bMax) bMax = profile.bins[i];
      if (profile.bins[i] > 1e-15) bNonZero++;
    }
    console.log(`[ping:complete] bins min=${bMin.toExponential(3)} max=${bMax.toExponential(3)} nonZero=${bNonZero}/${profile.bins.length}`);

    const state = store.get();
    const lp = state.lastProfile;
    if (lp.corr) {
      console.log(`[ping:complete] drawing profile corr.length=${lp.corr.length} tau0=${lp.tau0} c=${lp.c}`);
      drawProfile(lp.corr, lp.tau0, lp.c, lp.minR, lp.maxR);
    } else {
      console.warn('[ping:complete] no corr in lastProfile');
    }

    // Update heatmap row for current angle (works for both single Ping and Scan)
    const heatmap = state.heatmap;
    if (heatmap) {
      const rowIdx = heatmap.angles.indexOf(angleDeg);
      console.log(`[ping:complete] heatmap lookup: angleDeg=${angleDeg} rowIdx=${rowIdx} angles=${JSON.stringify(heatmap.angles)}`);
      if (rowIdx >= 0) {
        updateHeatmapRow(heatmap, rowIdx, profile.bins, profile.bestBin, profile.bestStrength);
      } else {
        console.warn(`[ping:complete] angle ${angleDeg} not found in heatmap angles`);
      }
    } else {
      console.warn('[ping:complete] no heatmap in store');
    }

    drawHeatmap(state.config.minRange, state.config.maxRange);
    drawGeometry(state.config.minRange, state.config.maxRange);
    updateBestReadout();
    updateDirectionReadout();

    // Ping stats
    const elapsed = (performance.now() - pingStartTime).toFixed(0);
    const peak = profile.bestStrength;
    const bins = profile.bins;
    if (bins && bins.length > 0) {
      const sorted = Float32Array.from(bins).sort();
      const median = sorted[Math.floor(sorted.length / 2)];
      const snr = median > 1e-12 ? 10 * Math.log10(peak / median) : 0;
      const statsEl = el('pingStats');
      if (statsEl) {
        statsEl.style.display = 'inline-block';
        statsEl.textContent = `Ping: ${elapsed}ms | peak: ${peak.toFixed(4)} | SNR: ${snr.toFixed(1)} dB`;
      }
    }
  });

  // Resize
  window.addEventListener('resize', () => {
    if (applyRetinaCanvases()) redrawAllCanvases();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resumeIfSuspended().catch(() => {});
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
  drawSignalPreview();

  refreshDeviceInfo().catch(() => {});
  renderCalibInfo();
}
