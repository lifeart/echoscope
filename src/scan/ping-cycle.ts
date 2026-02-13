import { store } from '../core/store.js';
import { bus } from '../core/event-bus.js';
import { sleep } from '../utils.js';
import { fftCorrelate } from '../dsp/fft-correlate.js';
import { findDirectPathTau } from '../calibration/direct-path.js';
import { buildRangeProfileFromCorrelation } from '../dsp/profile.js';
import { estimateBestFromProfile } from '../dsp/peak.js';
import { applyQualityAlgorithms } from '../dsp/quality.js';
import type { QualityAlgoName } from '../dsp/quality.js';
import { applyEnvBaseline } from '../dsp/clutter.js';
import { suppressStaticReflections, type ClutterState } from '../dsp/clutter.js';
import { createProbe } from '../signal/probe-factory.js';
import { resumeIfSuspended, getSampleRate } from '../audio/engine.js';
import { pingAndCaptureSteered } from '../spatial/steering.js';
import { computeSteeringDelay } from '../spatial/steering.js';
import { predictedTau0ForPing } from '../calibration/engine.js';
import type { RangeProfile } from '../types.js';

let clutterState: ClutterState = { model: null };

export function resetClutter(): void {
  clutterState = { model: null };
}

function signalEnergy(a: Float32Array): number {
  let e = 0;
  for (let i = 0; i < a.length; i++) e += a[i] * a[i];
  return e;
}

function energyNormalize(corr: Float32Array, refEnergy: number): void {
  if (refEnergy <= 1e-12) return;
  const inv = 1 / refEnergy;
  for (let i = 0; i < corr.length; i++) corr[i] *= inv;
}

function corrAndBuildProfile(
  micWin: Float32Array,
  ref: Float32Array,
  c: number,
  minR: number,
  maxR: number,
  predictedTau0OrNull: number | null,
  lockStrength: number,
  sampleRate: number,
  heatBins: number,
) {
  const corr = fftCorrelate(micWin, ref, sampleRate).correlation;
  const refE = signalEnergy(ref);
  energyNormalize(corr, refE);

  // Debug: correlation stats
  let corrMax = 0, corrMaxIdx = 0, micMax = 0;
  for (let i = 0; i < corr.length; i++) { const v = Math.abs(corr[i]); if (v > corrMax) { corrMax = v; corrMaxIdx = i; } }
  for (let i = 0; i < micWin.length; i++) { const v = Math.abs(micWin[i]); if (v > micMax) micMax = v; }
  console.log(`[corrAndBuild] micLen=${micWin.length} micMax=${micMax.toExponential(3)} refLen=${ref.length} refEnergy=${refE.toExponential(3)} corrLen=${corr.length} corrMax=${corrMax.toExponential(3)} corrMaxIdx=${corrMaxIdx} predTau0=${predictedTau0OrNull?.toFixed(6) ?? 'null'}`);

  const tau0 = findDirectPathTau(corr, predictedTau0OrNull, lockStrength, sampleRate);
  console.log(`[corrAndBuild] tau0=${tau0.toFixed(6)} (${(tau0 * 1000).toFixed(2)}ms, sample=${Math.round(tau0 * sampleRate)})`);

  const prof = buildRangeProfileFromCorrelation(corr, tau0, c, minR, maxR, sampleRate, heatBins);
  const best = estimateBestFromProfile(prof, minR, maxR);
  return { corr, tau0, prof, bestBin: best.bin, bestVal: best.val, bestR: best.range };
}

async function captureGolaySteered(
  a: Float32Array,
  b: Float32Array,
  gapMs: number,
  dt: number,
  gain: number,
  listenMs: number,
  c: number,
  minR: number,
  maxR: number,
  lockStrength: number,
  sampleRate: number,
  heatBins: number,
) {
  const capA = await pingAndCaptureSteered(a, dt, gain, listenMs);
  const predTau0A = predictedTau0ForPing(capA.delayL, capA.delayR);

  await sleep(Math.max(0, gapMs));

  const capB = await pingAndCaptureSteered(b, dt, gain, listenMs);
  const predTau0B = predictedTau0ForPing(capB.delayL, capB.delayR);

  // Sum raw correlations WITHOUT per-half normalization to preserve Golay sidelobe cancellation
  const corrA = fftCorrelate(capA.micWin, a, sampleRate).correlation;
  const corrB = fftCorrelate(capB.micWin, b, sampleRate).correlation;
  const L = Math.min(corrA.length, corrB.length);
  const corrSum = new Float32Array(L);
  for (let i = 0; i < L; i++) corrSum[i] = corrA[i] + corrB[i];
  const totalEnergy = signalEnergy(a) + signalEnergy(b);
  energyNormalize(corrSum, totalEnergy);

  // Debug: Golay correlation stats
  let micMaxA = 0, micMaxB = 0, corrSumMax = 0, corrSumMaxIdx = 0;
  for (let i = 0; i < capA.micWin.length; i++) { const v = Math.abs(capA.micWin[i]); if (v > micMaxA) micMaxA = v; }
  for (let i = 0; i < capB.micWin.length; i++) { const v = Math.abs(capB.micWin[i]); if (v > micMaxB) micMaxB = v; }
  for (let i = 0; i < corrSum.length; i++) { const v = Math.abs(corrSum[i]); if (v > corrSumMax) { corrSumMax = v; corrSumMaxIdx = i; } }
  console.log(`[golayCorr] micA=${capA.micWin.length} micMaxA=${micMaxA.toExponential(3)} micB=${capB.micWin.length} micMaxB=${micMaxB.toExponential(3)} totalEnergy=${totalEnergy.toExponential(3)} corrSumLen=${L} corrSumMax=${corrSumMax.toExponential(3)} corrSumMaxIdx=${corrSumMaxIdx}`);

  let predTau0: number | null = null;
  if (Number.isFinite(predTau0A) && Number.isFinite(predTau0B)) predTau0 = 0.5 * ((predTau0A ?? 0) + (predTau0B ?? 0));
  else if (Number.isFinite(predTau0A)) predTau0 = predTau0A;
  else if (Number.isFinite(predTau0B)) predTau0 = predTau0B;

  const tau0 = findDirectPathTau(corrSum, predTau0, lockStrength, sampleRate);
  console.log(`[golayCorr] tau0=${tau0.toFixed(6)} (${(tau0 * 1000).toFixed(2)}ms) predTau0=${predTau0?.toFixed(6) ?? 'null'}`);

  const prof = buildRangeProfileFromCorrelation(corrSum, tau0, c, minR, maxR, sampleRate, heatBins);
  return { corr: corrSum, tau0, prof };
}

export async function doPing(
  angleDeg: number,
  updateHeatRowIndex: number | null = null,
): Promise<RangeProfile> {
  await resumeIfSuspended();

  const state = store.get();
  const config = state.config;
  const sr = getSampleRate();
  const d = config.spacing;
  const c = config.speedOfSound;
  const gain = config.gain;
  const listenMs = config.listenMs;
  const minR = config.minRange;
  const maxR = config.maxRange;
  const heatBins = config.heatBins;
  const strengthGate = config.strengthGate;

  const dt = computeSteeringDelay(angleDeg, d, c);
  const probe = createProbe(config.probe, sr);

  const lockStrength = (state.calibration?.valid && config.calibration.useCalib)
    ? state.calibration.quality : 0;

  let corrFinal: Float32Array;
  let tau0Final: number;
  let profFinal: Float32Array;

  bus.emit('ping:start', { angleDeg });

  if (probe.type === 'golay' && probe.a && probe.b) {
    const golay = await captureGolaySteered(
      probe.a, probe.b, probe.gapMs ?? 12,
      dt, gain, listenMs, c, minR, maxR, lockStrength, sr, heatBins,
    );
    corrFinal = golay.corr;
    tau0Final = golay.tau0;
    profFinal = golay.prof;
  } else {
    const ref = probe.ref!;
    const cap = await pingAndCaptureSteered(ref, dt, gain, listenMs);
    const predTau0 = predictedTau0ForPing(cap.delayL, cap.delayR);
    const res = corrAndBuildProfile(cap.micWin, ref, c, minR, maxR, predTau0, lockStrength, sr, heatBins);
    corrFinal = res.corr;
    tau0Final = res.tau0;
    profFinal = res.prof;
  }

  // Debug: raw profile stats
  let rawMax = 0;
  {
    let rawNZ = 0;
    for (let i = 0; i < profFinal.length; i++) { if (profFinal[i] > rawMax) rawMax = profFinal[i]; if (profFinal[i] > 1e-15) rawNZ++; }
    console.log(`[doPing:raw] angle=${angleDeg} rawMax=${rawMax.toExponential(3)} nonZero=${rawNZ}/${profFinal.length}`);
  }

  // Apply env baseline
  const envBaseline = state.calibration?.envBaseline ?? null;
  if (config.envBaseline.enabled) {
    const beforeBaseline = profFinal;
    profFinal = applyEnvBaseline(profFinal, envBaseline, config.envBaseline.strength);
    let eMax = 0, eNZ = 0;
    for (let i = 0; i < profFinal.length; i++) { if (profFinal[i] > eMax) eMax = profFinal[i]; if (profFinal[i] > 1e-15) eNZ++; }
    console.log(`[doPing:envBaseline] max=${eMax.toExponential(3)} nonZero=${eNZ}/${profFinal.length}`);
    // Safeguard: if envBaseline removed ALL signal but raw had data, fall back
    if (eMax < 1e-15 && rawMax > 1e-15) {
      console.warn('[doPing] envBaseline zeroed out entire profile — falling back to raw profile');
      profFinal = beforeBaseline;
    }
  }

  // Apply static clutter suppression during scanning
  if (updateHeatRowIndex !== null && config.clutterSuppression.enabled) {
    const result = suppressStaticReflections(profFinal, clutterState, config.clutterSuppression.strength);
    profFinal = result.profile;
    clutterState = result.clutterState;
    let cMax = 0, cNZ = 0;
    for (let i = 0; i < profFinal.length; i++) { if (profFinal[i] > cMax) cMax = profFinal[i]; if (profFinal[i] > 1e-15) cNZ++; }
    console.log(`[doPing:clutter] max=${cMax.toExponential(3)} nonZero=${cNZ}/${profFinal.length}`);
  }

  // Apply quality algorithms
  const algoName: QualityAlgoName = config.qualityAlgo === 'auto' ? 'balanced' : config.qualityAlgo;
  profFinal = applyQualityAlgorithms(profFinal, algoName);
  {
    let qMax = 0, qNZ = 0;
    for (let i = 0; i < profFinal.length; i++) { if (profFinal[i] > qMax) qMax = profFinal[i]; if (profFinal[i] > 1e-15) qNZ++; }
    console.log(`[doPing:quality] algo=${algoName} max=${qMax.toExponential(3)} nonZero=${qNZ}/${profFinal.length}`);
  }

  const bestPost = estimateBestFromProfile(profFinal, minR, maxR);
  let bestBin = bestPost.bin;
  let bestVal = bestPost.val;
  let bestR = bestPost.range;

  const isWeak = bestVal < strengthGate;
  console.log(`[doPing:gate] bestVal=${bestVal.toExponential(3)} strengthGate=${strengthGate} isWeak=${isWeak}`);
  if (isWeak) {
    bestBin = -1;
    bestVal = 0;
    bestR = NaN;
  }

  // Update store
  store.update(s => {
    s.lastProfile.corr = corrFinal;
    s.lastProfile.tau0 = tau0Final;
    s.lastProfile.c = c;
    s.lastProfile.minR = minR;
    s.lastProfile.maxR = maxR;

    if (!isWeak && Number.isFinite(bestR)) {
      s.lastTarget.angle = angleDeg;
      s.lastTarget.range = bestR;
      s.lastTarget.strength = bestVal;
    } else if (updateHeatRowIndex === null) {
      s.lastTarget.angle = NaN;
      s.lastTarget.range = NaN;
      s.lastTarget.strength = 0;
    }

    if (updateHeatRowIndex === null) {
      if (!isWeak && Number.isFinite(bestR)) {
        s.lastDirection.angle = angleDeg;
        s.lastDirection.strength = bestVal;
      }
    }
  });

  // Debug: log profile stats before emitting
  let profMin = Infinity, profMax = -Infinity, profNonZero = 0;
  for (let i = 0; i < profFinal.length; i++) {
    if (profFinal[i] < profMin) profMin = profFinal[i];
    if (profFinal[i] > profMax) profMax = profFinal[i];
    if (profFinal[i] > 1e-15) profNonZero++;
  }
  console.log(`[doPing] angle=${angleDeg} profLen=${profFinal.length} profMin=${profMin.toExponential(3)} profMax=${profMax.toExponential(3)} nonZero=${profNonZero}/${profFinal.length} bestBin=${bestBin} bestVal=${bestVal.toExponential(3)} bestR=${bestR.toFixed(3)} isWeak=${isWeak} tau0=${tau0Final.toFixed(6)}`);

  const rangeProfile: RangeProfile = {
    bins: profFinal,
    minRange: minR,
    maxRange: maxR,
    binCount: heatBins,
    bestBin,
    bestRange: bestR,
    bestStrength: bestVal,
  };

  bus.emit('ping:complete', { angleDeg, profile: rangeProfile });
  return rangeProfile;
}
