import { clamp } from '../utils.js';
import { store } from '../core/store.js';

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

export function setStatus(msg: string): void {
  const statusEl = el('status');
  if (statusEl) statusEl.textContent = 'Status: ' + msg;
}

export function log(msg: string): void {
  const logEl = el('log');
  if (logEl) {
    logEl.textContent += msg + '\n';
    logEl.scrollTop = logEl.scrollHeight;
  }
}

export function classifyDirection(angleDeg: number, axis: 'horizontal' | 'vertical'): string {
  if (!Number.isFinite(angleDeg)) return '\u2014';
  const deadZone = 7;
  if (Math.abs(angleDeg) <= deadZone) return 'Center';
  if (axis === 'vertical') return angleDeg >= 0 ? 'Top' : 'Bottom';
  return angleDeg >= 0 ? 'Right' : 'Left';
}

export function updateDirectionReadout(): void {
  const dirReadoutEl = el('dirReadout');
  if (!dirReadoutEl) return;

  const state = store.get();
  const angleDeg = state.lastDirection.angle;
  const strength = state.lastDirection.strength;
  const gate = state.config.strengthGate;
  const axis = state.config.directionAxis;

  if (!Number.isFinite(angleDeg) || !Number.isFinite(strength) || strength <= gate) {
    dirReadoutEl.textContent = 'Direction: \u2014';
    return;
  }

  const direction = classifyDirection(angleDeg, axis);
  const confidence = clamp((strength - gate) / Math.max(1e-6, 1 - gate), 0, 1);
  const axisTag = axis === 'vertical' ? 'T/B' : 'L/R';
  dirReadoutEl.textContent = `Direction: ${direction} (${axisTag}, ${(confidence * 100).toFixed(0)}%)`;
}

export function updateBestReadout(): void {
  const bestReadoutEl = el('bestReadout');
  if (!bestReadoutEl) return;

  const state = store.get();
  const target = state.lastTarget;
  const gate = state.config.strengthGate;

  if (Number.isFinite(target.range) && target.strength > gate) {
    bestReadoutEl.textContent = `Best: \u03b8=${target.angle.toFixed(0)}\u00b0  R\u2248${target.range.toFixed(2)} m  strength=${target.strength.toFixed(3)}`;
  } else if (target.strength <= gate && target.strength > 0) {
    bestReadoutEl.textContent = `Best: \u2014 (below gate ${gate.toFixed(2)})`;
  } else {
    bestReadoutEl.textContent = 'Best: \u2014';
  }
}

export function renderCalibInfo(): void {
  const calibInfoEl = el('calibInfo');
  const sanityTextEl = el('sanityText');
  if (!calibInfoEl) return;

  const state = store.get();
  const calib = state.calibration;

  const lines: string[] = [];
  lines.push(`Calibration: ${calib?.valid ? 'VALID' : 'not calibrated'}`);

  if (!calib?.valid) {
    const mic = state.presetMicPosition;
    if (mic.x !== null && mic.y !== null) {
      lines.push(`Using preset mic estimate: (${mic.x}, ${mic.y})m`);
    }
    lines.push('Tap: Calibrate (refined + sanity)');
    calibInfoEl.textContent = lines.join('\n');
    if (sanityTextEl) sanityTextEl.textContent = 'Run calibration to populate sanity view.';
    return;
  }

  lines.push(`quality = ${calib.quality.toFixed(2)} (lock strength), angleReliable = ${calib.angleReliable ? 'YES' : 'no'}`);
  lines.push(`mono output likely = ${calib.monoLikely ? 'YES' : 'no'}`);
  lines.push(`d=${state.config.spacing.toFixed(3)}m, c=${state.config.speedOfSound.toFixed(1)}m/s`);
  lines.push(`tauMeasL=${(calib.tauMeasured.L * 1e3).toFixed(2)}ms (MAD=${(calib.tauMAD.L * 1e3).toFixed(2)}ms), peakL\u2248${calib.peaks.L.toFixed(3)}`);
  lines.push(`tauMeasR=${(calib.tauMeasured.R * 1e3).toFixed(2)}ms (MAD=${(calib.tauMAD.R * 1e3).toFixed(2)}ms), peakR\u2248${calib.peaks.R.toFixed(3)}`);
  lines.push(`tauSysCommon\u2248${(calib.systemDelay.common * 1e3).toFixed(2)}ms`);
  lines.push(`tauSysL\u2248${(calib.systemDelay.L * 1e3).toFixed(2)}ms, tauSysR\u2248${(calib.systemDelay.R * 1e3).toFixed(2)}ms`);
  lines.push(`rL\u2248${calib.distances.L.toFixed(3)}m, rR\u2248${calib.distances.R.toFixed(3)}m`);
  lines.push(`mic(x,y)\u2248(${calib.micPosition.x.toFixed(3)}, ${calib.micPosition.y.toFixed(3)})m, deltaConsistency\u2248${calib.geometryError.toFixed(4)}`);
  lines.push(`env baseline = ${(calib.envBaseline && calib.envBaselinePings > 0) ? `YES (${calib.envBaselinePings} pings)` : 'no'}`);
  lines.push(`Direct-path lock: ${(state.config.calibration.useCalib && calib.quality > 0.2) ? 'ON' : 'OFF/weak'}`);
  calibInfoEl.textContent = lines.join('\n');

  if (sanityTextEl && calib.sanity.have) {
    const s = calib.sanity;
    const ma = s.monoAssessment;
    const t: string[] = [];
    t.push('Sanity decision breakdown (thresholds):');
    t.push(`- |\u0394tau| = ${(ma.dt * 1e3).toFixed(3)} ms  (monoByTime if < 0.070 ms) => ${ma.monoByTime ? 'YES' : 'no'}`);
    t.push(`- |\u0394tau|/maxTDOA < 10%  (monoByRelTime) => ${ma.monoByRelTime ? 'YES' : 'no'}`);
    t.push(`- |\u0394peak| = ${ma.dp.toFixed(3)}     (monoByPeak if < 0.050) => ${ma.monoByPeak ? 'YES' : 'no'}`);
    t.push(`- expectDiff = ${ma.expectDiff ? 'YES' : 'no'}  (based on d/c > 0.300 ms)`);
    t.push(`=> monoLikely = ${calib.monoLikely ? 'YES' : 'no'}`);
    t.push('');
    t.push('Picked peaks:');
    t.push(`- L-only: tau=${(s.tauL * 1e3).toFixed(3)} ms, peak=${s.peakL.toFixed(3)}`);
    t.push(`- R-only: tau=${(s.tauR * 1e3).toFixed(3)} ms, peak=${s.peakR.toFixed(3)}`);
    sanityTextEl.textContent = t.join('\n');
  } else if (sanityTextEl) {
    sanityTextEl.textContent = 'Sanity curves not captured yet.';
  }
}
