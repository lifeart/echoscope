import { store } from '../core/store.js';
import { bus } from '../core/event-bus.js';
import { sleep, median, mad } from '../utils.js';
import { clamp } from '../utils.js';
import { fftCorrelate } from '../dsp/fft-correlate.js';
import { absMaxNormalize } from '../dsp/normalize.js';
import { measureRoundTripLatency } from '../audio/latency.js';
import { findPeakAbs } from '../dsp/peak.js';
import { buildRangeProfileFromCorrelation } from '../dsp/profile.js';
import { applyQualityAlgorithms } from '../dsp/quality.js';
import { genGolayChipped } from '../signal/golay.js';
import { pingAndCaptureOneSide, pingAndCaptureSteered } from '../spatial/steering.js';
import { getSampleRate } from '../audio/engine.js';
import { assessMonoDecision } from './mono-detect.js';
import { computeCalibQuality } from './quality-score.js';
import { computeEnvBaseline } from './env-baseline.js';
import { estimateMicXY } from '../spatial/geometry.js';
import type { CalibrationResult, CalibrationSanity, GolayConfig } from '../types.js';

function golaySumCorrelation(
  micWinA: Float32Array,
  micWinB: Float32Array,
  a: Float32Array,
  b: Float32Array,
  sampleRate: number,
): Float32Array {
  const corrA = fftCorrelate(micWinA, a, sampleRate).correlation; absMaxNormalize(corrA);
  const corrB = fftCorrelate(micWinB, b, sampleRate).correlation; absMaxNormalize(corrB);
  const L = Math.min(corrA.length, corrB.length);
  const sum = new Float32Array(L);
  for (let i = 0; i < L; i++) sum[i] = corrA[i] + corrB[i];
  absMaxNormalize(sum);
  return sum;
}

function earlyPeakFromCorrelation(
  sumCorr: Float32Array,
  earlyMs: number,
  sampleRate: number,
): { idx: number; tau: number; peak: number } {
  const earlyEnd = Math.min(sumCorr.length, Math.floor(sampleRate * (earlyMs / 1000)));
  const pk = findPeakAbs(sumCorr, 0, earlyEnd);
  return { idx: pk.index, tau: pk.index / sampleRate, peak: pk.absValue };
}

export function predictedTau0ForPing(
  delayL: number,
  delayR: number,
): number | null {
  const state = store.get();
  const calib = state.calibration;
  if (!calib?.valid || !state.config.calibration.useCalib) return null;
  if (calib.quality <= 0.2) return null;
  const c = state.config.speedOfSound;
  const tL = calib.systemDelay.L + delayL + (calib.distances.L / c);
  const tR = calib.systemDelay.R + delayR + (calib.distances.R / c);
  return Math.min(tL, tR);
}

export async function calibrateRefinedWithSanity(): Promise<CalibrationResult> {
  const state = store.get();
  const ctx = state.audio.context;
  if (!ctx) throw new Error('Init audio first');

  store.set('status', 'calibrating');

  const config = state.config;
  const sr = getSampleRate();
  const d = config.spacing;
  const c = config.speedOfSound;
  const gain = config.gain;
  const listenMs = Math.max(140, config.listenMs);
  const repeats = clamp(config.calibration.repeats, 1, 9);
  const repeatGap = Math.max(30, config.calibration.gapMs);
  const extraCalPings = clamp(config.envBaseline.pings, 0, 12);
  const minR = config.minRange;
  const maxR = config.maxRange;
  const heatBins = config.heatBins;

  if (!(d > 0.02)) throw new Error('Speaker spacing d must be set (meters)');
  if (!(c > 200 && c < 400)) throw new Error('Speed of sound c looks wrong');

  const { baseLatency, outputLatency } = state.audio;
  const rtLatencyMs = measureRoundTripLatency(baseLatency, outputLatency);

  console.debug(`[calib] starting: sr=${sr} d=${d.toFixed(3)}m c=${c.toFixed(1)} gain=${gain.toFixed(2)} repeats=${repeats} listenMs=${listenMs} envPings=${extraCalPings}`);
  console.debug(`[calib] audio latency: base=${(baseLatency * 1000).toFixed(2)}ms output=${(outputLatency * 1000).toFixed(2)}ms roundTrip=${rtLatencyMs.toFixed(2)}ms`);

  const earlyMs = 60;
  const golayConfig: GolayConfig = {
    order: (config.probe.type === 'golay') ? config.probe.params.order : 10,
    chipRate: (config.probe.type === 'golay') ? config.probe.params.chipRate : 5000,
    gapMs: (config.probe.type === 'golay') ? config.probe.params.gapMs : 12,
  };
  const { a, b } = genGolayChipped(golayConfig, sr);
  const gapMs = golayConfig.gapMs;

  console.debug(`[calib] golay: order=${golayConfig.order} chipRate=${golayConfig.chipRate} refLen=${a.length} gapMs=${gapMs}`);

  const tauL: number[] = [], tauR: number[] = [];
  const pkL: number[] = [], pkR: number[] = [];

  for (let k = 0; k < repeats; k++) {
    const capLA = await pingAndCaptureOneSide(a, 'L', gain, listenMs);
    await sleep(Math.max(0, gapMs));
    const capLB = await pingAndCaptureOneSide(b, 'L', gain, listenMs);

    console.debug(`[calib] repeat ${k + 1}/${repeats} L capture: micWin=${capLA.micWin.length} samples (${(capLA.micWin.length / sr * 1000).toFixed(1)}ms) ref=${a.length}`);

    const sumL = golaySumCorrelation(capLA.micWin, capLB.micWin, a, b, sr);
    const mL = earlyPeakFromCorrelation(sumL, earlyMs, sr);
    tauL.push(mL.tau); pkL.push(mL.peak);
    console.debug(`[calib] repeat ${k + 1}/${repeats} L: tau=${(mL.tau * 1000).toFixed(4)}ms peak=${mL.peak.toFixed(4)} idx=${mL.idx} corrLen=${sumL.length}`);

    await sleep(repeatGap);

    const capRA = await pingAndCaptureOneSide(a, 'R', gain, listenMs);
    await sleep(Math.max(0, gapMs));
    const capRB = await pingAndCaptureOneSide(b, 'R', gain, listenMs);

    const sumR = golaySumCorrelation(capRA.micWin, capRB.micWin, a, b, sr);
    const mR = earlyPeakFromCorrelation(sumR, earlyMs, sr);
    tauR.push(mR.tau); pkR.push(mR.peak);
    console.debug(`[calib] repeat ${k + 1}/${repeats} R: tau=${(mR.tau * 1000).toFixed(4)}ms peak=${mR.peak.toFixed(4)} idx=${mR.idx} corrLen=${sumR.length}`);

    await sleep(repeatGap);
  }

  const medTauL = median(tauL);
  const medTauR = median(tauR);
  const medPkL = median(pkL);
  const medPkR = median(pkR);
  const madTauL = mad(tauL, medTauL);
  const madTauR = mad(tauR, medTauR);

  console.debug(`[calib] statistics: medTauL=${(medTauL * 1000).toFixed(4)}ms medTauR=${(medTauR * 1000).toFixed(4)}ms madL=${(madTauL * 1000).toFixed(4)}ms madR=${(madTauR * 1000).toFixed(4)}ms`);
  console.debug(`[calib] peak strengths: medPkL=${medPkL.toFixed(4)} medPkR=${medPkR.toFixed(4)}`);
  console.debug(`[calib] raw tauL=[${tauL.map(t => (t * 1000).toFixed(3)).join(', ')}]ms tauR=[${tauR.map(t => (t * 1000).toFixed(3)).join(', ')}]ms`);

  const rMin = 0.04;
  const tauSysCommon = Math.max(0, Math.min(medTauL, medTauR) - (rMin / c));

  let rL = c * Math.max(0, medTauL - tauSysCommon);
  let rR = c * Math.max(0, medTauR - tauSysCommon);
  rL = Math.max(rMin, rL);
  rR = Math.max(rMin, rR);

  const geo = estimateMicXY(rL, rR, d);
  const tauSysL = Math.max(0, medTauL - (rL / c));
  const tauSysR = Math.max(0, medTauR - (rR / c));

  console.debug(`[calib] distances: rL=${rL.toFixed(4)}m rR=${rR.toFixed(4)}m tauSysCommon=${(tauSysCommon * 1000).toFixed(4)}ms`);
  console.debug(`[calib] system delays: L=${(tauSysL * 1000).toFixed(4)}ms R=${(tauSysR * 1000).toFixed(4)}ms delta=${((tauSysL - tauSysR) * 1000).toFixed(4)}ms`);
  console.debug(`[calib] geometry: mic=(${geo.x.toFixed(4)}, ${geo.y.toFixed(4)}) err=${geo.err.toFixed(4)} spacing=${d.toFixed(3)}m`);

  const mono = assessMonoDecision(medTauL, medTauR, medPkL, medPkR, d, c);
  console.debug(`[calib] mono assessment: monoLikely=${mono.monoLikely} dt=${(mono.dt * 1000).toFixed(4)}ms dp=${mono.dp.toFixed(4)} monoByTime=${mono.monoByTime} monoByPeak=${mono.monoByPeak}`);

  const quality = computeCalibQuality({
    tauMadL: madTauL, tauMadR: madTauR,
    peakL: medPkL, peakR: medPkR,
    geomErr: geo.err, monoLikely: mono.monoLikely,
  });
  console.debug(`[calib] quality score: ${quality.toFixed(4)}`);

  // Sanity capture
  const capLA = await pingAndCaptureOneSide(a, 'L', gain, listenMs);
  await sleep(Math.max(0, gapMs));
  const capLB = await pingAndCaptureOneSide(b, 'L', gain, listenMs);
  const sumLSanity = golaySumCorrelation(capLA.micWin, capLB.micWin, a, b, sr);

  const capRA = await pingAndCaptureOneSide(a, 'R', gain, listenMs);
  await sleep(Math.max(0, gapMs));
  const capRB = await pingAndCaptureOneSide(b, 'R', gain, listenMs);
  const sumRSanity = golaySumCorrelation(capRA.micWin, capRB.micWin, a, b, sr);

  const earlyN = Math.min(sumLSanity.length, Math.floor(sr * (earlyMs / 1000)));
  const curveL = sumLSanity.slice(0, earlyN);
  const curveR = sumRSanity.slice(0, earlyN);

  const pk1 = findPeakAbs(curveL, 0, curveL.length);
  const pk2 = findPeakAbs(curveR, 0, curveR.length);
  const mono2 = assessMonoDecision(
    pk1.index / sr, pk2.index / sr,
    pk1.absValue, pk2.absValue, d, c,
  );

  console.debug(`[calib] sanity check: tauL=${(pk1.index / sr * 1000).toFixed(4)}ms tauR=${(pk2.index / sr * 1000).toFixed(4)}ms peakL=${pk1.absValue.toFixed(4)} peakR=${pk2.absValue.toFixed(4)} mono=${mono2.monoLikely}`);

  const sanity: CalibrationSanity = {
    have: true,
    curveL, curveR,
    peakIndexL: pk1.index, peakIndexR: pk2.index,
    earlyMs,
    tauL: pk1.index / sr, tauR: pk2.index / sr,
    peakL: pk1.absValue, peakR: pk2.absValue,
    monoAssessment: mono2,
  };

  // Env baseline
  let envBaseline: Float32Array | null = null;
  let envBaselinePings = 0;
  if (extraCalPings > 0 && Number.isFinite(minR) && Number.isFinite(maxR) && maxR > minR) {
    const profiles: Float32Array[] = [];
    for (let i = 0; i < extraCalPings; i++) {
      // Capture at theta=0 using steered stereo Golay (both speakers active)
      const cA = await pingAndCaptureSteered(a, 0, gain, listenMs);
      await sleep(Math.max(0, gapMs));
      const cB = await pingAndCaptureSteered(b, 0, gain, listenMs);
      const corrSum = golaySumCorrelation(cA.micWin, cB.micWin, a, b, sr);
      const envTau0 = 0.5 * (medTauL + medTauR);
      let prof = buildRangeProfileFromCorrelation(corrSum, envTau0, c, minR, maxR, sr, heatBins);
      prof = applyQualityAlgorithms(prof, 'balanced');
      profiles.push(prof);
      await sleep(Math.max(20, repeatGap * 0.4));
    }
    envBaseline = computeEnvBaseline(profiles, heatBins);
    envBaselinePings = profiles.length;
    console.debug(`[calib] env baseline: ${envBaselinePings} pings captured (steered at 0deg), envTau0=${(0.5 * (medTauL + medTauR) * 1000).toFixed(4)}ms`);
  }

  // Mark calibration invalid when measurements are clearly unreliable
  const maxMadMs = 1000 * Math.max(madTauL, madTauR);
  const geometryValid = geo.err < 1.0; // y² was non-negative (triangle inequality holds)
  const measurementsStable = maxMadMs < 5.0; // worst-channel MAD < 5ms
  const micPlausible = Math.abs(geo.x) < d * 3; // mic X within 3× speaker spacing
  const valid = measurementsStable && (geometryValid || micPlausible) && quality > 0.15;

  console.debug(`[calib] validity: valid=${valid} maxMAD=${maxMadMs.toFixed(3)}ms stable=${measurementsStable} geomValid=${geometryValid} micPlausible=${micPlausible} quality=${quality.toFixed(3)}>0.15=${quality > 0.15}`);

  const result: CalibrationResult = {
    valid,
    quality,
    monoLikely: mono.monoLikely,
    tauMeasured: { L: medTauL, R: medTauR },
    tauMAD: { L: madTauL, R: madTauR },
    peaks: { L: medPkL, R: medPkR },
    distances: { L: rL, R: rR },
    micPosition: { x: geo.x, y: geo.y },
    systemDelay: { common: tauSysCommon, L: tauSysL, R: tauSysR },
    geometryError: geo.err,
    envBaseline,
    envBaselinePings,
    sanity,
  };

  console.debug(`[calib] result: valid=${result.valid} quality=${result.quality.toFixed(3)} mono=${result.monoLikely} rL=${result.distances.L.toFixed(4)}m rR=${result.distances.R.toFixed(4)}m sysDelay={L:${(result.systemDelay.L * 1000).toFixed(3)}ms R:${(result.systemDelay.R * 1000).toFixed(3)}ms common:${(result.systemDelay.common * 1000).toFixed(3)}ms}`);

  store.set('calibration', result);
  store.set('status', 'ready');
  bus.emit('calibration:done', result);

  return result;
}
