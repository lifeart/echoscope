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
  energyNormalize(corr, signalEnergy(ref));
  const tau0 = findDirectPathTau(corr, predictedTau0OrNull, lockStrength, sampleRate);
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
  energyNormalize(corrSum, signalEnergy(a) + signalEnergy(b));

  let predTau0: number | null = null;
  if (Number.isFinite(predTau0A) && Number.isFinite(predTau0B)) predTau0 = 0.5 * ((predTau0A ?? 0) + (predTau0B ?? 0));
  else if (Number.isFinite(predTau0A)) predTau0 = predTau0A;
  else if (Number.isFinite(predTau0B)) predTau0 = predTau0B;

  const tau0 = findDirectPathTau(corrSum, predTau0, lockStrength, sampleRate);
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

  // Apply env baseline
  const envBaseline = state.calibration?.envBaseline ?? null;
  if (config.envBaseline.enabled) {
    profFinal = applyEnvBaseline(profFinal, envBaseline, config.envBaseline.strength);
  }

  // Apply static clutter suppression during scanning
  if (updateHeatRowIndex !== null && config.clutterSuppression.enabled) {
    const result = suppressStaticReflections(profFinal, clutterState, config.clutterSuppression.strength);
    profFinal = result.profile;
    clutterState = result.clutterState;
  }

  // Apply quality algorithms
  const algoName: QualityAlgoName = config.qualityAlgo === 'auto' ? 'balanced' : config.qualityAlgo;
  profFinal = applyQualityAlgorithms(profFinal, algoName);

  const bestPost = estimateBestFromProfile(profFinal, minR, maxR);
  let bestBin = bestPost.bin;
  let bestVal = bestPost.val;
  let bestR = bestPost.range;

  const isWeak = bestVal < strengthGate;
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
