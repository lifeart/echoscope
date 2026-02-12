import { store } from '../core/store.js';
import { clamp } from '../utils.js';
import type { ProbeConfig } from '../types.js';

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function inputVal(id: string): number {
  return parseFloat((el(id) as HTMLInputElement)?.value ?? '0');
}

function selectVal(id: string): string {
  return (el(id) as HTMLSelectElement)?.value ?? '';
}

function checkVal(id: string): boolean {
  return (el(id) as HTMLInputElement)?.checked ?? false;
}

export function readConfigFromDOM(): void {
  const mode = selectVal('mode');
  let probe: ProbeConfig;
  if (mode === 'mls') {
    probe = { type: 'mls', params: { order: inputVal('mlsOrder'), chipRate: inputVal('chipRate') } };
  } else if (mode === 'golay') {
    probe = { type: 'golay', params: { order: inputVal('golayOrder'), chipRate: inputVal('golayChipRate'), gapMs: inputVal('golayGapMs') } };
  } else {
    probe = { type: 'chirp', params: { f1: inputVal('f1'), f2: inputVal('f2'), durationMs: inputVal('T') } };
  }

  store.update(s => {
    s.config.probe = probe;
    s.config.steeringAngleDeg = inputVal('angle');
    s.config.spacing = inputVal('spacing');
    s.config.speedOfSound = inputVal('c');
    s.config.gain = inputVal('gain');
    s.config.listenMs = inputVal('listenMs');
    s.config.minRange = inputVal('minR');
    s.config.maxRange = inputVal('maxR');
    s.config.scanStep = inputVal('scanStep');
    s.config.scanDwell = inputVal('scanDwell');
    s.config.strengthGate = clamp(inputVal('strengthGate'), 0, 1);
    s.config.qualityAlgo = selectVal('qualityAlgo') as any;
    s.config.directionAxis = selectVal('dirAxis') as any;
    s.config.clutterSuppression.enabled = checkVal('scanClutterOn');
    s.config.clutterSuppression.strength = inputVal('scanClutterStrength');
    s.config.envBaseline.enabled = checkVal('useEnvBaseline');
    s.config.envBaseline.strength = inputVal('envBaselineStrength');
    s.config.envBaseline.pings = inputVal('extraCalPings');
    s.config.calibration.repeats = inputVal('calRepeats');
    s.config.calibration.gapMs = inputVal('calRepeatGapMs');
    s.config.calibration.useCalib = checkVal('useCalib');
  });
}

export function syncModeUI(): void {
  const m = selectVal('mode');
  const chirpBox = el('chirpBox');
  const mlsBox = el('mlsBox');
  const golayBox = el('golayBox');
  if (chirpBox) chirpBox.style.display = m === 'chirp' ? '' : 'none';
  if (mlsBox) mlsBox.style.display = m === 'mls' ? '' : 'none';
  if (golayBox) golayBox.style.display = m === 'golay' ? '' : 'none';
}

export function setButtonStates(audioReady: boolean, scanning: boolean): void {
  const btnPing = el('btnPing') as HTMLButtonElement | null;
  const btnScan = el('btnScan') as HTMLButtonElement | null;
  const btnStop = el('btnStop') as HTMLButtonElement | null;
  const btnCalibrate = el('btnCalibrate') as HTMLButtonElement | null;
  const btnRefreshDevices = el('btnRefreshDevices') as HTMLButtonElement | null;

  if (btnPing) btnPing.disabled = !audioReady || scanning;
  if (btnScan) btnScan.disabled = !audioReady || scanning;
  if (btnStop) btnStop.disabled = !audioReady;
  if (btnCalibrate) btnCalibrate.disabled = !audioReady || scanning;
  if (btnRefreshDevices) btnRefreshDevices.disabled = !audioReady;
}
