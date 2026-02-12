import { state } from './state.js';
import { el, log, setStatus, getDirectionAxis, updateDirectionReadout } from './dom.js';
import { initAudio, resumeIfSuspended, refreshDeviceInfo } from './audio.js';
import { getStrengthGate } from './profile.js';
import { applyRetinaCanvases, drawProfile, drawHeatmap, drawCalibSanityPlot, drawProfilePlaceholder, drawSanityPlaceholder } from './visualization.js';
import { drawGeometry, ensureGeometryWizardHandlesInitialized, resetGeometryWizardHandles, applyGeometryWizard, setGeomWizardStatus, syncGeometryWizardControls, geometryPointerDown, geometryPointerMove, geometryPointerUp } from './geometry.js';
import { renderCalibInfo, calibrateRefinedWithSanity } from './calibration.js';
import { DEVICE_PRESETS, detectDevice, applyDevicePreset, syncModeUI } from './presets.js';
import { doPing, doScan, stopAll, resetHeat } from './scan.js';

function redrawAllCanvases() {
  if (state.lastProfileCorr && state.lastProfileCorr.length) {
    drawProfile(state.lastProfileCorr, state.lastProfileTau0, state.lastProfileC, state.lastProfileMinR, state.lastProfileMaxR);
  } else {
    drawProfilePlaceholder();
  }

  const minR = parseFloat(el("minR").value);
  const maxR = parseFloat(el("maxR").value);
  drawHeatmap(minR, maxR);
  drawGeometry(minR, maxR);

  if (state.calib.sanity.have && state.calib.sanity.curveL && state.calib.sanity.curveR) {
    drawCalibSanityPlot(state.calib.sanity.curveL, state.calib.sanity.peakIdxL, state.calib.sanity.curveR, state.calib.sanity.peakIdxR, state.calib.sanity.earlyMs);
  } else {
    drawSanityPlaceholder();
  }
}

// ---------- Mode UI ----------
el("mode").addEventListener("change", syncModeUI);
syncModeUI();

// ---------- Service Worker ----------
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

// ---------- Angle slider ----------
el("angle").addEventListener("input", () => {
  el("angleVal").textContent = el("angle").value;
  const minR = parseFloat(el("minR").value);
  const maxR = parseFloat(el("maxR").value);
  drawGeometry(minR, maxR);
});

// ---------- Geometry canvas touch ----------
const geometryCanvas = el("geometry");
geometryCanvas.style.touchAction = "none";
geometryCanvas.addEventListener("pointerdown", geometryPointerDown);
geometryCanvas.addEventListener("pointermove", geometryPointerMove);
geometryCanvas.addEventListener("pointerup", geometryPointerUp);
geometryCanvas.addEventListener("pointercancel", geometryPointerUp);

// ---------- Button wiring ----------
el("btnInit").addEventListener("click", async () => {
  try { setStatus("initializing"); await initAudio(renderCalibInfo); }
  catch (e) { setStatus("error"); log("[err] init failed: " + (e?.message || e)); }
});

el("btnPing").addEventListener("click", async () => {
  try { setStatus("pinging"); await doPing(parseFloat(el("angle").value), null); setStatus("ready"); }
  catch (e) { setStatus("error"); log("[err] ping failed: " + (e?.message || e)); }
});

el("btnScan").addEventListener("click", async () => {
  try { await doScan(); }
  catch (e) { setStatus("error"); log("[err] scan failed: " + (e?.message || e)); stopAll(); }
});

el("btnStop").addEventListener("click", () => stopAll());

el("btnCalibrate").addEventListener("click", async () => {
  try { await calibrateRefinedWithSanity(); }
  catch (e) { setStatus("error"); log("[err] calibrate failed: " + (e?.message || e)); renderCalibInfo(); }
});

el("btnRefreshDevices").addEventListener("click", async () => {
  try { await refreshDeviceInfo(); }
  catch (e) { log("[err] refresh devices failed: " + (e?.message || e)); }
});

// ---------- Device preset ----------
el("devicePreset").addEventListener("change", () => {
  const key = el("devicePreset").value;
  applyDevicePreset(key);
});

// ---------- Geometry wizard ----------
el("geomWizardOn").addEventListener("change", () => {
  state.geomWizard.active = !!el("geomWizardOn").checked;
  state.geomWizard.dragging = null;
  if (state.geomWizard.active) {
    ensureGeometryWizardHandlesInitialized(true);
    setGeomWizardStatus("Drag handles on geometry view, then Apply geometry.");
  } else {
    setGeomWizardStatus("Enable wizard to drag speakers/mic on geometry view.");
  }
  syncGeometryWizardControls();
  const minR = parseFloat(el("minR").value);
  const maxR = parseFloat(el("maxR").value);
  drawGeometry(minR, maxR);
});

el("btnGeomReset").addEventListener("click", () => {
  if (!state.geomWizard.active) return;
  resetGeometryWizardHandles();
});

el("btnGeomApply").addEventListener("click", () => {
  if (!state.geomWizard.active) return;
  applyGeometryWizard();
});

// ---------- Trace & direction ----------
el("showTrace").addEventListener("change", () => {
  const minR = parseFloat(el("minR").value);
  const maxR = parseFloat(el("maxR").value);
  drawHeatmap(minR, maxR);
});

el("dirAxis").addEventListener("change", () => {
  updateDirectionReadout(state.lastDirectionAngle, state.lastDirectionStrength, getStrengthGate());
  const minR = parseFloat(el("minR").value);
  const maxR = parseFloat(el("maxR").value);
  drawGeometry(minR, maxR);
});

el("useCalib").addEventListener("change", () => renderCalibInfo());

// ---------- Resize & visibility ----------
window.addEventListener("resize", () => {
  if (applyRetinaCanvases()) redrawAllCanvases();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") resumeIfSuspended().catch(() => {});
});

// ---------- Initial render ----------
(async () => {
  setStatus("idle");
  syncGeometryWizardControls();
  applyRetinaCanvases();
  drawProfilePlaceholder();

  const detected = detectDevice();
  applyDevicePreset(detected, true);
  log(`[init] device: ${DEVICE_PRESETS[detected]?.name || detected}`);

  const minR = parseFloat(el("minR").value);
  const maxR = parseFloat(el("maxR").value);
  resetHeat([-60, -50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50, 60]);
  drawHeatmap(minR, maxR);
  drawGeometry(minR, maxR);

  drawSanityPlaceholder();

  await refreshDeviceInfo();
  renderCalibInfo();
})();
