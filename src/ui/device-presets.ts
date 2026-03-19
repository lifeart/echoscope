import { store } from '../core/store.js';
import { DEVICE_PRESETS, LAPTOP_PRESET_SCAN } from '../constants.js';
import { log } from './readouts.js';

export function detectDevice(): string {
  const ua = navigator.userAgent;
  const w = window.screen.width;
  const h = window.screen.height;
  const tp = navigator.maxTouchPoints || 0;

  if (/iPhone/.test(ua)) return 'iphone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && tp > 1)) {
    const larger = Math.max(w, h);
    if (larger < 1100) return 'ipadmini';
    if (larger >= 1200) return 'ipad13';
    return 'ipad11';
  }
  if (/Mac/.test(ua)) {
    const lw = Math.max(w, h);
    if (lw >= 2200) return 'imac24';
    if (lw >= 1700) return 'mbp16';
    if (lw >= 1500) return 'mbp14';
    if (lw >= 1400) return 'mba15';
    if (lw >= 1250) return 'mba13';
  }

  // Android devices
  if (/Android/.test(ua)) {
    const larger = Math.max(w, h);
    if (larger >= 1000 || (tp > 0 && Math.min(w, h) >= 600)) return 'android_tablet';
    return 'android_phone';
  }

  // Surface devices (Windows + touch + mid-size screen)
  if (/Windows/.test(ua) && /Surface/.test(ua)) return 'surface';

  // ChromeOS / Chromebook
  if (/CrOS/.test(ua)) return 'chromebook';

  // Windows or Linux laptop (non-touch or small touch, moderate screen)
  if (/Windows|Linux/.test(ua)) {
    const lw = Math.max(w, h);
    // Large screen without touch suggests desktop with external monitor
    if (lw >= 2200 && tp === 0) return 'generic_desktop';
    return 'generic_laptop';
  }

  return 'custom';
}

export function applyDevicePreset(key: string, silent = false): void {
  const preset = DEVICE_PRESETS[key];
  if (!preset) return;

  const devicePresetEl = document.getElementById('devicePreset') as HTMLSelectElement | null;
  if (devicePresetEl) devicePresetEl.value = key;

  localStorage.setItem('echoscope:devicePreset', key);

  store.update(s => {
    s.config.devicePreset = key;
    if (preset.d !== null) {
      s.config.spacing = preset.d;
      const spacingEl = document.getElementById('spacing') as HTMLInputElement | null;
      if (spacingEl) spacingEl.value = preset.d.toFixed(3);
    }
    if (preset.mic.x !== null && preset.mic.y !== null) {
      s.presetMicPosition.x = preset.mic.x;
      s.presetMicPosition.y = preset.mic.y;
    } else {
      s.presetMicPosition.x = null;
      s.presetMicPosition.y = null;
    }
    if (preset.micSpacing !== null) {
      s.config.micArraySpacing = preset.micSpacing;
      const micSpacingEl = document.getElementById('micArraySpacing') as HTMLInputElement | null;
      if (micSpacingEl) micSpacingEl.value = preset.micSpacing.toFixed(3);
    }
  });

  if (!silent) {
    const dStr = preset.d !== null ? `d=${preset.d}m` : 'manual';
    const micStr = preset.mic.x !== null ? `mic\u2248(${preset.mic.x}, ${preset.mic.y})m` : 'manual';
    log(`[preset] ${preset.name}: ${dStr}, ${micStr}`);

    // Show "(detected)" hint on auto-detected preset option
    const option = devicePresetEl?.querySelector(`option[value="${key}"]`);
    if (option && !option.textContent?.includes('(detected)')) {
      option.textContent += ' (detected)';
    }
  }

  // Apply laptop mode scan settings if checkbox is checked
  const shouldApplyScanPreset = store.get().config.presetApplyScan;
  if (shouldApplyScanPreset && key.startsWith('mb')) {
    applyLaptopScanPreset();
  }
}

function applyLaptopScanPreset(): void {
  const lp = LAPTOP_PRESET_SCAN;
  const sets: Record<string, string> = {
    mode: lp.mode,
    scanStep: String(lp.scanStep),
    scanPasses: String(lp.scanPasses),
    strengthGate: String(lp.strengthGate),
    scanClutterStrength: String(lp.clutterStrength),
    qualityAlgo: lp.qualityAlgo,
    extraCalPings: String(lp.extraCalPings),
    envBaselineStrength: String(lp.envBaselineStrength),
    micArraySpacing: String(lp.micArraySpacing),
    displayBlankingStartRange: '0.30',
    displayBlankingEndRange: '0.85',
    displayBlankingAttenuation: '0.80',
    displayBlankingEdgeSoftness: '0.08',
  };

  for (const [id, val] of Object.entries(sets)) {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (el) el.value = val;
  }

  const clutterOn = document.getElementById('scanClutterOn') as HTMLInputElement | null;
  if (clutterOn) clutterOn.checked = true;
  const envOn = document.getElementById('useEnvBaseline') as HTMLInputElement | null;
  if (envOn) envOn.checked = true;
  const showTrace = document.getElementById('showTrace') as HTMLInputElement | null;
  if (showTrace) showTrace.checked = true;
  const displayBlanking = document.getElementById('displayBlankingOn') as HTMLInputElement | null;
  if (displayBlanking) displayBlanking.checked = true;

  log(
    `[preset] laptop mode applied: golay, step=${lp.scanStep}\u00b0, passes=${lp.scanPasses}, gate=${lp.strengthGate}, clutter=${lp.clutterStrength}, quality=${lp.qualityAlgo}, blanking=on`,
  );
}
