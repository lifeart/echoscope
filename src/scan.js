import { state } from './state.js';
import { clamp, sleep } from './utils.js';
import { el, log, setStatus, updateDirectionReadout } from './dom.js';
import { genChirp, genGolayChipped, genMLSChipped } from './signal.js';
import { correlate, absMaxNormalize, findDirectPathTau, estimateBestFromProfile, buildRangeProfileFromCorrelation } from './dsp.js';
import { getStrengthGate, shouldSuppressStaticReflections, suppressStaticReflectionsInProfile, applyEnvBaselineToProfile, applyQualityProfileAlgorithms, qualityAlgoLabel } from './profile.js';
import { resumeIfSuspended, pingAndCaptureSteered } from './audio.js';
import { drawProfile, drawHeatmap } from './visualization.js';
import { drawGeometry } from './geometry.js';
import { predictedTau0ForPing } from './calibration.js';

function buildRefForMode(mode) {
  if (mode === "chirp") {
    const f1 = parseFloat(el("f1").value);
    const f2 = parseFloat(el("f2").value);
    const Tms = parseFloat(el("T").value);
    return { type: "single", ref: genChirp(f1, f2, Tms) };
  }
  if (mode === "mls") {
    const m = parseInt(el("mlsOrder").value, 10);
    const chipRate = parseFloat(el("chipRate").value);
    return { type: "single", ref: genMLSChipped(m, chipRate) };
  }
  const n = parseInt(el("golayOrder").value, 10);
  const chipRate = parseFloat(el("golayChipRate").value);
  const gapMs = parseFloat(el("golayGapMs").value);
  const { a, b } = genGolayChipped(n, chipRate);
  return { type: "pair", a, b, gapMs };
}

function corrAndBuildProfile(micWin, ref, c, minR, maxR, predictedTau0OrNull, lockStrength) {
  const corr = correlate(micWin, ref);
  absMaxNormalize(corr);

  const tau0 = findDirectPathTau(corr, predictedTau0OrNull, lockStrength);

  const prof = buildRangeProfileFromCorrelation(corr, tau0, c, minR, maxR);
  const best = estimateBestFromProfile(prof, minR, maxR);

  return { corr, tau0, prof, bestBin: best.bin, bestVal: best.val, bestR: best.range };
}

export async function captureGolaySteeredProfile(a, b, gapMs, dt, gain, listenMs, c, minR, maxR, lockStrength) {
  const capA = await pingAndCaptureSteered(a, dt, gain, listenMs);
  const predTau0A = predictedTau0ForPing(capA.delayL, capA.delayR);
  const resA = corrAndBuildProfile(capA.micWin, a, c, minR, maxR, predTau0A, lockStrength);

  await sleep(Math.max(0, gapMs));

  const capB = await pingAndCaptureSteered(b, dt, gain, listenMs);
  const predTau0B = predictedTau0ForPing(capB.delayL, capB.delayR);
  const resB = corrAndBuildProfile(capB.micWin, b, c, minR, maxR, predTau0B, lockStrength);

  const L = Math.min(resA.corr.length, resB.corr.length);
  const corrSum = new Float32Array(L);
  for (let i = 0; i < L; i++) corrSum[i] = resA.corr[i] + resB.corr[i];
  absMaxNormalize(corrSum);

  let predTau0 = null;
  if (Number.isFinite(predTau0A) && Number.isFinite(predTau0B)) predTau0 = 0.5 * (predTau0A + predTau0B);
  else if (Number.isFinite(predTau0A)) predTau0 = predTau0A;
  else if (Number.isFinite(predTau0B)) predTau0 = predTau0B;

  const tau0 = findDirectPathTau(corrSum, predTau0, lockStrength);
  const prof = buildRangeProfileFromCorrelation(corrSum, tau0, c, minR, maxR);

  return { corr: corrSum, tau0, prof };
}

export async function doPing(angleDeg, updateHeatRowIndex = null) {
  await resumeIfSuspended();

  const d = parseFloat(el("spacing").value);
  const c = parseFloat(el("c").value);
  const gain = parseFloat(el("gain").value);
  const listenMs = parseFloat(el("listenMs").value);
  const minR = parseFloat(el("minR").value);
  const maxR = parseFloat(el("maxR").value);

  const theta = angleDeg * Math.PI / 180;
  const dt = (d * Math.sin(theta)) / c;

  const mode = el("mode").value;
  const ref = buildRefForMode(mode);
  const strengthGate = getStrengthGate();

  const lockStrength = (state.calib.valid && el("useCalib").checked) ? state.calib.quality : 0;

  let corrFinal = null;
  let tau0Final = 0;
  let profFinal = new Float32Array(state.heatBins); profFinal.fill(0);
  let bestBinFinal = -1;
  let bestValFinal = 0;
  let bestRFinal = NaN;

  if (ref.type === "single") {
    const cap = await pingAndCaptureSteered(ref.ref, dt, gain, listenMs);
    const predTau0 = predictedTau0ForPing(cap.delayL, cap.delayR);
    const res = corrAndBuildProfile(cap.micWin, ref.ref, c, minR, maxR, predTau0, lockStrength);

    corrFinal = res.corr;
    tau0Final = res.tau0;
    profFinal = res.prof;
    bestBinFinal = res.bestBin;
    bestValFinal = res.bestVal;
    bestRFinal = res.bestR;
  } else {
    const golay = await captureGolaySteeredProfile(ref.a, ref.b, ref.gapMs, dt, gain, listenMs, c, minR, maxR, lockStrength);
    corrFinal = golay.corr;
    tau0Final = golay.tau0;
    profFinal = golay.prof;
  }

  applyEnvBaselineToProfile(profFinal);

  if (updateHeatRowIndex !== null && shouldSuppressStaticReflections()) {
    suppressStaticReflectionsInProfile(profFinal);
  }

  profFinal = applyQualityProfileAlgorithms(profFinal);
  const bestPost = estimateBestFromProfile(profFinal, minR, maxR);
  bestBinFinal = bestPost.bin;
  bestValFinal = bestPost.val;
  bestRFinal = bestPost.range;

  const isWeak = bestValFinal < strengthGate;
  if (isWeak) {
    bestBinFinal = -1;
    bestValFinal = 0;
    bestRFinal = NaN;
    if (updateHeatRowIndex !== null) profFinal.fill(0);
  }

  if (!isWeak && Number.isFinite(bestRFinal)) {
    state.lastTargetAngle = angleDeg;
    state.lastTargetRange = bestRFinal;
    state.lastTargetStrength = bestValFinal;
  } else if (updateHeatRowIndex === null) {
    state.lastTargetAngle = NaN;
    state.lastTargetRange = NaN;
    state.lastTargetStrength = 0;
  }

  if (updateHeatRowIndex !== null && state.heat) {
    const row = updateHeatRowIndex;
    for (let b = 0; b < state.heatBins; b++) {
      const idx = row * state.heatBins + b;
      state.heat[idx] = Math.max(state.heat[idx] * 0.90, profFinal[b]);
    }
    state.bestBin[row] = bestBinFinal;
    state.bestVal[row] = bestValFinal;
  }

  const bestReadoutEl = el("bestReadout");
  if (Number.isFinite(bestRFinal)) {
    bestReadoutEl.textContent = `Best: \u03b8=${angleDeg}\u00b0  R\u2248${bestRFinal.toFixed(2)} m  strength=${bestValFinal.toFixed(3)}`;
  } else if (isWeak) {
    bestReadoutEl.textContent = `Best: \u2014 (below gate ${strengthGate.toFixed(2)})`;
  } else {
    bestReadoutEl.textContent = "Best: \u2014";
  }

  if (updateHeatRowIndex === null) {
    if (!isWeak && Number.isFinite(bestRFinal)) {
      state.lastDirectionAngle = angleDeg;
      state.lastDirectionStrength = bestValFinal;
    }
    updateDirectionReadout(state.lastDirectionAngle, state.lastDirectionStrength, strengthGate);
  }

  const modeTag = (ref.type === "single") ? mode : "golay";
  const bestText = Number.isFinite(bestRFinal) ? `${bestRFinal.toFixed(2)}m (v=${bestValFinal.toFixed(3)})` : "\u2014";
  log(`[ping] \u03b8=${angleDeg}\u00b0 mode=${modeTag} dt=${(dt * 1e6).toFixed(1)}\u00b5s tau0=${(tau0Final * 1e3).toFixed(2)}ms best=${bestText} lock=${lockStrength.toFixed(2)} algo=${qualityAlgoLabel()}`);

  state.lastProfileCorr = corrFinal;
  state.lastProfileTau0 = tau0Final;
  state.lastProfileC = c;
  state.lastProfileMinR = minR;
  state.lastProfileMaxR = maxR;

  drawProfile(corrFinal, tau0Final, c, minR, maxR);
  drawHeatmap(minR, maxR);
  drawGeometry(minR, maxR);
}

export function resetHeat(angles) {
  state.heatAngles = angles.slice();
  state.heat = new Float32Array(state.heatAngles.length * state.heatBins);
  state.heat.fill(0);
  state.heatDisplay = new Float32Array(state.heatAngles.length * state.heatBins);
  state.heatDisplay.fill(0);
  state.scanClutter = new Float32Array(state.heatBins);
  state.scanClutter.fill(0);
  state.bestBin = new Int16Array(state.heatAngles.length);
  state.bestVal = new Float32Array(state.heatAngles.length);
  for (let i = 0; i < state.heatAngles.length; i++) { state.bestBin[i] = -1; state.bestVal[i] = 0; }
}

export async function doScan() {
  state.scanning = true;
  el("btnStop").disabled = false;
  el("btnScan").disabled = true;
  el("btnPing").disabled = true;
  setStatus("scanning");

  const step = Math.max(1, parseInt(el("scanStep").value, 10));
  const dwell = Math.max(30, parseInt(el("scanDwell").value, 10));
  const minR = parseFloat(el("minR").value);
  const maxR = parseFloat(el("maxR").value);

  const angles = [];
  for (let a = -60; a <= 60; a += step) angles.push(a);
  resetHeat(angles);

  for (let i = 0; i < angles.length; i++) {
    if (!state.scanning) break;
    const a = angles[i];
    el("angle").value = String(a);
    el("angleVal").textContent = String(a);

    await doPing(a, i);
    await sleep(dwell);
  }

  const gate = getStrengthGate();
  let bestRow = -1;
  let bestScore = -Infinity;
  for (let r = 0; r < angles.length; r++) {
    if (state.bestBin[r] < 0) continue;
    if (state.bestVal[r] > bestScore) {
      bestScore = state.bestVal[r];
      bestRow = r;
    }
  }
  if (bestRow >= 0 && bestScore > gate) {
    state.lastDirectionAngle = angles[bestRow];
    state.lastDirectionStrength = bestScore;
    updateDirectionReadout(state.lastDirectionAngle, state.lastDirectionStrength, gate);

    const b = state.bestBin[bestRow];
    if (b >= 0 && Number.isFinite(minR) && Number.isFinite(maxR) && maxR > minR) {
      const rDet = minR + (b / Math.max(1, state.heatBins - 1)) * (maxR - minR);
      state.lastTargetAngle = angles[bestRow];
      state.lastTargetRange = rDet;
      state.lastTargetStrength = bestScore;
      el("bestReadout").textContent = `Best: \u03b8=${state.lastTargetAngle.toFixed(0)}\u00b0  R\u2248${rDet.toFixed(2)} m  strength=${bestScore.toFixed(3)}`;
    }
  } else {
    updateDirectionReadout(NaN, 0, gate);
    state.lastTargetAngle = NaN;
    state.lastTargetRange = NaN;
    state.lastTargetStrength = 0;
  }

  drawGeometry(minR, maxR);

  state.scanning = false;
  el("btnStop").disabled = false;
  el("btnScan").disabled = false;
  el("btnPing").disabled = false;
  setStatus("ready");
  log("[scan] done");
}

export function stopAll() {
  state.scanning = false;
  setStatus(state.ac ? "ready" : "idle");
  log("[stop] stopped");
}
