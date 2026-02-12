import { state } from './state.js';
import { clamp, sleep, median, mad } from './utils.js';
import { el, log, setStatus } from './dom.js';
import { genGolayChipped } from './signal.js';
import { correlate, absMaxNormalize, findPeakAbs, estimateMicXY } from './dsp.js';
import { applyQualityProfileAlgorithms } from './profile.js';
import { resumeIfSuspended, pingAndCaptureOneSide } from './audio.js';
import { drawCalibSanityPlot } from './visualization.js';

export { estimateMicXY };

export function predictedTau0ForPing(delayL, delayR) {
  if (!state.calib.valid || !el("useCalib").checked) return null;
  const lockStrength = state.calib.quality;
  if (lockStrength <= 0.2) return null;
  const tL = state.calib.tauSysL + delayL + (state.calib.rL / state.calib.c);
  const tR = state.calib.tauSysR + delayR + (state.calib.rR / state.calib.c);
  return Math.min(tL, tR);
}

export function renderCalibInfo() {
  const calibInfoEl = el("calibInfo");
  const sanityTextEl = el("sanityText");
  const useCalibEl = el("useCalib");

  const lines = [];
  lines.push(`Calibration: ${state.calib.valid ? "VALID" : "not calibrated"}`);
  if (!state.calib.valid) {
    if (state.presetMicPosition.x !== null && state.presetMicPosition.y !== null) {
      lines.push(`Using preset mic estimate: (${state.presetMicPosition.x}, ${state.presetMicPosition.y})m`);
    }
    lines.push("Tap: Calibrate (refined + sanity)");
    calibInfoEl.textContent = lines.join("\n");
    sanityTextEl.textContent = "Run calibration to populate sanity view.";
    return;
  }

  lines.push(`quality = ${state.calib.quality.toFixed(2)} (lock strength)`);
  lines.push(`mono output likely = ${state.calib.monoLikely ? "YES" : "no"}`);
  lines.push(`d=${state.calib.d.toFixed(3)}m, c=${state.calib.c.toFixed(1)}m/s`);
  lines.push(`tauMeasL=${(state.calib.tauMeasL * 1e3).toFixed(2)}ms (MAD=${(state.calib.tauMadL * 1e3).toFixed(2)}ms), peakL\u2248${state.calib.peakL.toFixed(3)}`);
  lines.push(`tauMeasR=${(state.calib.tauMeasR * 1e3).toFixed(2)}ms (MAD=${(state.calib.tauMadR * 1e3).toFixed(2)}ms), peakR\u2248${state.calib.peakR.toFixed(3)}`);
  lines.push(`tauSysCommon\u2248${(state.calib.tauSysCommon * 1e3).toFixed(2)}ms`);
  lines.push(`tauSysL\u2248${(state.calib.tauSysL * 1e3).toFixed(2)}ms, tauSysR\u2248${(state.calib.tauSysR * 1e3).toFixed(2)}ms`);
  lines.push(`rL\u2248${state.calib.rL.toFixed(3)}m, rR\u2248${state.calib.rR.toFixed(3)}m`);
  lines.push(`mic(x,y)\u2248(${state.calib.x.toFixed(3)}, ${state.calib.y.toFixed(3)})m, geomErr\u2248${state.calib.geomErr.toFixed(4)}`);
  lines.push(`env baseline = ${(state.calib.envBaseline && state.calib.envBaselinePings > 0) ? `YES (${state.calib.envBaselinePings} pings)` : "no"}`);
  lines.push(`Direct-path lock: ${(useCalibEl.checked && state.calib.quality > 0.2) ? "ON" : "OFF/weak"}`);
  calibInfoEl.textContent = lines.join("\n");

  if (state.calib.sanity.have) {
    const s = state.calib.sanity;
    const t = [];
    t.push(`Sanity decision breakdown (thresholds):`);
    t.push(`- |\u0394tau| = ${(s.dt * 1e3).toFixed(3)} ms  (monoByTime if < 0.150 ms) => ${s.monoByTime ? "YES" : "no"}`);
    t.push(`- |\u0394peak| = ${s.dp.toFixed(3)}     (monoByPeak if < 0.070) => ${s.monoByPeak ? "YES" : "no"}`);
    t.push(`- expectDiff = ${s.expectDiff ? "YES" : "no"}  (based on d/c > 0.300 ms)`);
    t.push(`=> monoLikely = ${(state.calib.monoLikely) ? "YES" : "no"}`);
    t.push(``);
    t.push(`Picked peaks:`);
    t.push(`- L-only: tau=${(s.tauL * 1e3).toFixed(3)} ms, peak=${s.peakL.toFixed(3)}`);
    t.push(`- R-only: tau=${(s.tauR * 1e3).toFixed(3)} ms, peak=${s.peakR.toFixed(3)}`);
    sanityTextEl.textContent = t.join("\n");
  } else {
    sanityTextEl.textContent = "Sanity curves not captured yet.";
  }
}

function genCalibrationReference() {
  const n = parseInt(el("golayOrder").value, 10);
  const chipRate = parseFloat(el("golayChipRate").value);
  const gapMs = Math.max(6, parseFloat(el("golayGapMs").value));
  const { a, b } = genGolayChipped(n, chipRate);
  return { a, b, gapMs };
}

function golaySumCorrelation(micWinA, micWinB, a, b) {
  const corrA = correlate(micWinA, a); absMaxNormalize(corrA);
  const corrB = correlate(micWinB, b); absMaxNormalize(corrB);
  const L = Math.min(corrA.length, corrB.length);
  const sum = new Float32Array(L);
  for (let i = 0; i < L; i++) sum[i] = corrA[i] + corrB[i];
  absMaxNormalize(sum);
  return sum;
}

function earlyPeakFromCorrelation(sumCorr, earlyMs) {
  const earlyEnd = Math.min(sumCorr.length, Math.floor(state.sr * (earlyMs / 1000)));
  const pk = findPeakAbs(sumCorr, 0, earlyEnd);
  return { idx: pk.index, tau: pk.index / state.sr, peak: pk.absValue };
}

function assessMonoDecision(tauL, tauR, peakL, peakR, d, c) {
  const dt = Math.abs(tauL - tauR);
  const dp = Math.abs(peakL - peakR);
  const monoByTime = dt < 0.00015;
  const monoByPeak = dp < 0.07;
  const expectDiff = (d / c) > 0.0003;
  const monoLikely = (monoByTime && monoByPeak && expectDiff);
  return { dt, dp, monoByTime, monoByPeak, expectDiff, monoLikely };
}

function computeCalibQuality(stats) {
  const madMs = 1000 * Math.max(stats.tauMadL, stats.tauMadR);
  const madScore = clamp(1.0 - (madMs / 1.2), 0, 1);
  const peakScore = clamp((Math.min(stats.peakL, stats.peakR) - 0.10) / 0.25, 0, 1);
  const geomScore = clamp(1.0 - (stats.geomErr / 0.05), 0, 1);
  const monoPenalty = stats.monoLikely ? 0.25 : 1.0;
  return clamp(0.45 * madScore + 0.35 * peakScore + 0.20 * geomScore, 0, 1) * monoPenalty;
}

export async function calibrateRefinedWithSanity() {
  if (!state.ac) throw new Error("Init audio first");
  await resumeIfSuspended();
  setStatus("calibrating");

  const d = parseFloat(el("spacing").value);
  const c = parseFloat(el("c").value);
  const gain = parseFloat(el("gain").value);
  const listenMs = Math.max(140, parseFloat(el("listenMs").value));
  const repeats = clamp(parseInt(el("calRepeats").value, 10) || 1, 1, 9);
  const repeatGap = Math.max(30, parseFloat(el("calRepeatGapMs").value));
  const extraCalPings = clamp(parseInt(el("extraCalPings").value, 10) || 0, 0, 12);
  const minR = parseFloat(el("minR").value);
  const maxR = parseFloat(el("maxR").value);

  if (!(d > 0.02)) throw new Error("Speaker spacing d must be set (meters)");
  if (!(c > 200 && c < 400)) throw new Error("Speed of sound c looks wrong");

  const earlyMs = 60;
  const { a, b, gapMs } = genCalibrationReference();

  const tauL = [], tauR = [];
  const pkL = [], pkR = [];

  log(`[cal] refined start: repeats=${repeats}, listen=${listenMs}ms`);
  for (let k = 0; k < repeats; k++) {
    log(`[cal] rep ${k + 1}/${repeats}: L-only A\u2026`);
    const capLA = await pingAndCaptureOneSide(a, "L", gain, listenMs);
    await sleep(Math.max(0, gapMs));
    log(`[cal] rep ${k + 1}/${repeats}: L-only B\u2026`);
    const capLB = await pingAndCaptureOneSide(b, "L", gain, listenMs);

    const sumL = golaySumCorrelation(capLA.micWin, capLB.micWin, a, b);
    const mL = earlyPeakFromCorrelation(sumL, earlyMs);
    tauL.push(mL.tau); pkL.push(mL.peak);

    await sleep(repeatGap);

    log(`[cal] rep ${k + 1}/${repeats}: R-only A\u2026`);
    const capRA = await pingAndCaptureOneSide(a, "R", gain, listenMs);
    await sleep(Math.max(0, gapMs));
    log(`[cal] rep ${k + 1}/${repeats}: R-only B\u2026`);
    const capRB = await pingAndCaptureOneSide(b, "R", gain, listenMs);

    const sumR = golaySumCorrelation(capRA.micWin, capRB.micWin, a, b);
    const mR = earlyPeakFromCorrelation(sumR, earlyMs);
    tauR.push(mR.tau); pkR.push(mR.peak);

    await sleep(repeatGap);
  }

  const medTauL = median(tauL);
  const medTauR = median(tauR);
  const medPkL = median(pkL);
  const medPkR = median(pkR);
  const madTauL = mad(tauL, medTauL);
  const madTauR = mad(tauR, medTauR);

  const rMin = 0.04;
  const tauSysCommon = Math.max(0, Math.min(medTauL, medTauR) - (rMin / c));

  let rL = c * Math.max(0, medTauL - tauSysCommon);
  let rR = c * Math.max(0, medTauR - tauSysCommon);
  rL = Math.max(rMin, rL);
  rR = Math.max(rMin, rR);

  const geo = estimateMicXY(rL, rR, d);

  const tauSysL = Math.max(0, medTauL - (rL / c));
  const tauSysR = Math.max(0, medTauR - (rR / c));

  const mono = assessMonoDecision(medTauL, medTauR, medPkL, medPkR, d, c);

  const q = computeCalibQuality({
    tauMadL: madTauL,
    tauMadR: madTauR,
    peakL: medPkL,
    peakR: medPkR,
    geomErr: geo.err,
    monoLikely: mono.monoLikely
  });

  state.calib.valid = true;
  state.calib.quality = q;
  state.calib.monoLikely = mono.monoLikely;
  state.calib.d = d;
  state.calib.c = c;
  state.calib.tauMeasL = medTauL;
  state.calib.tauMeasR = medTauR;
  state.calib.peakL = medPkL;
  state.calib.peakR = medPkR;
  state.calib.tauMadL = madTauL;
  state.calib.tauMadR = madTauR;
  state.calib.tauSysCommon = tauSysCommon;
  state.calib.tauSysL = tauSysL;
  state.calib.tauSysR = tauSysR;
  state.calib.rL = rL;
  state.calib.rR = rR;
  state.calib.x = geo.x;
  state.calib.y = geo.y;
  state.calib.geomErr = geo.err;

  // Sanity capture
  log("[cal] sanity capture: L-only (fresh) \u2026");
  const capLA = await pingAndCaptureOneSide(a, "L", gain, listenMs);
  await sleep(Math.max(0, gapMs));
  const capLB = await pingAndCaptureOneSide(b, "L", gain, listenMs);
  const sumL = golaySumCorrelation(capLA.micWin, capLB.micWin, a, b);

  log("[cal] sanity capture: R-only (fresh) \u2026");
  const capRA = await pingAndCaptureOneSide(a, "R", gain, listenMs);
  await sleep(Math.max(0, gapMs));
  const capRB = await pingAndCaptureOneSide(b, "R", gain, listenMs);
  const sumR = golaySumCorrelation(capRA.micWin, capRB.micWin, a, b);

  const earlyN = Math.min(sumL.length, Math.floor(state.sr * (earlyMs / 1000)));
  const curveL = sumL.slice(0, earlyN);
  const curveR = sumR.slice(0, earlyN);

  const pk1 = findPeakAbs(curveL, 0, curveL.length);
  const pk2 = findPeakAbs(curveR, 0, curveR.length);

  const tau1 = pk1.index / state.sr;
  const tau2 = pk2.index / state.sr;
  const peak1 = pk1.absValue;
  const peak2 = pk2.absValue;

  const mono2 = assessMonoDecision(tau1, tau2, peak1, peak2, d, c);

  state.calib.sanity.have = true;
  state.calib.sanity.earlyMs = earlyMs;
  state.calib.sanity.curveL = curveL;
  state.calib.sanity.curveR = curveR;
  state.calib.sanity.peakIdxL = pk1.index;
  state.calib.sanity.peakIdxR = pk2.index;
  state.calib.sanity.tauL = tau1;
  state.calib.sanity.tauR = tau2;
  state.calib.sanity.peakL = peak1;
  state.calib.sanity.peakR = peak2;
  state.calib.sanity.dt = mono2.dt;
  state.calib.sanity.dp = mono2.dp;
  state.calib.sanity.expectDiff = mono2.expectDiff;
  state.calib.sanity.monoByTime = mono2.monoByTime;
  state.calib.sanity.monoByPeak = mono2.monoByPeak;

  // Environmental baseline (dynamic import to break cycle with scan.js)
  state.calib.envBaseline = null;
  state.calib.envBaselinePings = 0;
  if (extraCalPings > 0 && Number.isFinite(minR) && Number.isFinite(maxR) && maxR > minR) {
    const { captureGolaySteeredProfile } = await import('./scan.js');
    log(`[cal] env baseline capture: ${extraCalPings} pings at \u03b8=0\u00b0 \u2026`);
    const acc = new Float32Array(state.heatBins);
    let used = 0;
    for (let i = 0; i < extraCalPings; i++) {
      const env = await captureGolaySteeredProfile(a, b, gapMs, 0, gain, listenMs, c, minR, maxR, q);
      let envProf = env.prof;
      envProf = applyQualityProfileAlgorithms(envProf);
      for (let k = 0; k < state.heatBins; k++) acc[k] += envProf[k];
      used++;
      await sleep(Math.max(20, repeatGap * 0.4));
    }
    if (used > 0) {
      const inv = 1 / used;
      for (let k = 0; k < state.heatBins; k++) acc[k] *= inv;
      absMaxNormalize(acc);
      state.calib.envBaseline = acc;
      state.calib.envBaselinePings = used;
      log(`[cal] env baseline ready (${used} pings)`);
    }
  }

  drawCalibSanityPlot(curveL, pk1.index, curveR, pk2.index, earlyMs);
  el("sanityDetails").open = true;

  renderCalibInfo();

  log(`[cal] medTauL=${(medTauL * 1e3).toFixed(2)}ms (MAD ${(madTauL * 1e3).toFixed(2)}ms), medTauR=${(medTauR * 1e3).toFixed(2)}ms (MAD ${(madTauR * 1e3).toFixed(2)}ms)`);
  log(`[cal] peaks: L\u2248${medPkL.toFixed(3)}, R\u2248${medPkR.toFixed(3)} | monoLikely=${mono.monoLikely ? "YES" : "no"}`);
  log(`[cal] quality=${q.toFixed(2)} (direct-path lock will be ${(el("useCalib").checked && q > 0.2) ? "stronger" : "weak/off"})`);

  if (mono.monoLikely) log("[cal][warn] Output appears mono (L-only and R-only too similar).");
  if (q < 0.25) log("[cal][warn] Calibration quality is low; app avoids aggressive direct-path locking.");

  // Dynamic import to break cycle with geometry.js
  const { drawGeometry } = await import('./geometry.js');
  drawGeometry(minR, maxR);
  setStatus("ready");
}
