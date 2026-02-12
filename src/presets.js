import { state } from './state.js';
import { el, log } from './dom.js';
import { drawHeatmap } from './visualization.js';
import { drawGeometry, ensureGeometryWizardHandlesInitialized } from './geometry.js';

export const DEVICE_PRESETS = {
  'mbp14':  { name: 'MacBook Pro 14\u2033',  d: 0.245, mic: { x: 0, y: 0.01 } },
  'mbp16':  { name: 'MacBook Pro 16\u2033',  d: 0.275, mic: { x: 0, y: 0.01 } },
  'mba13':  { name: 'MacBook Air 13\u2033',  d: 0.195, mic: { x: 0, y: 0.01 } },
  'mba15':  { name: 'MacBook Air 15\u2033',  d: 0.235, mic: { x: 0, y: 0.01 } },
  'iphone': { name: 'iPhone (portrait)',      d: 0.140, mic: { x: 0.05, y: 0.01 } },
  'ipad11': { name: 'iPad Pro 11\u2033',      d: 0.180, mic: { x: 0, y: 0.005 } },
  'ipad13': { name: 'iPad Pro 13\u2033',      d: 0.215, mic: { x: 0, y: 0.005 } },
  'custom': { name: 'Custom',                 d: null,  mic: { x: null, y: null } },
};

export function detectDevice() {
  const ua = navigator.userAgent;
  const w = window.screen.width;
  const h = window.screen.height;
  const tp = navigator.maxTouchPoints || 0;

  if (/iPhone/.test(ua)) return 'iphone';

  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && tp > 1)) {
    const larger = Math.max(w, h);
    return (larger >= 1200) ? 'ipad13' : 'ipad11';
  }

  if (/Mac/.test(ua)) {
    const lw = Math.max(w, h);
    if (lw >= 1700) return 'mbp16';
    if (lw >= 1500) return 'mbp14';
    if (lw >= 1400) return 'mba15';
    if (lw >= 1250) return 'mba13';
  }

  return 'custom';
}

export function syncModeUI() {
  const m = el("mode").value;
  el("chirpBox").style.display = (m === "chirp") ? "" : "none";
  el("mlsBox").style.display = (m === "mls") ? "" : "none";
  el("golayBox").style.display = (m === "golay") ? "" : "none";
}

function applyLaptopModePreset() {
  el("mode").value = "golay";
  syncModeUI();

  el("scanStep").value = "3";
  el("scanDwell").value = "220";
  el("listenMs").value = "180";
  el("strengthGate").value = "0.05";
  el("scanClutterStrength").value = "0.70";
  el("qualityAlgo").value = "auto";
  el("extraCalPings").value = "6";
  el("envBaselineStrength").value = "0.60";

  const clutterOn = el("scanClutterOn");
  if (clutterOn) clutterOn.checked = true;
  const envBaselineOn = el("useEnvBaseline");
  if (envBaselineOn) envBaselineOn.checked = true;
  el("showTrace").checked = true;

  const minR = parseFloat(el("minR").value);
  const maxR = parseFloat(el("maxR").value);
  drawHeatmap(minR, maxR);

  log("[preset] laptop mode applied: golay, step=3\u00b0, dwell=220ms, listen=180ms, gate=0.05, static suppression=0.70, quality=auto, env pings=6");
}

export function applyDevicePreset(key, silent) {
  const preset = DEVICE_PRESETS[key];
  if (!preset) return;
  const devicePresetEl = el("devicePreset");
  if (devicePresetEl) devicePresetEl.value = key;

  if (preset.d !== null) {
    el("spacing").value = preset.d.toFixed(3);
  }

  if (preset.mic.x !== null && preset.mic.y !== null) {
    state.presetMicPosition.x = preset.mic.x;
    state.presetMicPosition.y = preset.mic.y;
  } else {
    state.presetMicPosition.x = null;
    state.presetMicPosition.y = null;
  }

  if (!silent) {
    const dStr = preset.d !== null ? `d=${preset.d}m` : 'manual';
    const micStr = preset.mic.x !== null ? `mic\u2248(${preset.mic.x}, ${preset.mic.y})m` : 'manual';
    log(`[preset] ${preset.name}: ${dStr}, ${micStr}`);
  }

  if (el("presetApplyScan")?.checked && key.startsWith('mb')) {
    applyLaptopModePreset();
  }

  ensureGeometryWizardHandlesInitialized(true);
  const minR = parseFloat(el("minR").value);
  const maxR = parseFloat(el("maxR").value);
  drawGeometry(minR, maxR);
}
