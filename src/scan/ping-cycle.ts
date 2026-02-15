import { store } from '../core/store.js';
import { bus } from '../core/event-bus.js';
import { sleep, signalEnergy, energyNormalize } from '../utils.js';
import { fftCorrelateComplex } from '../dsp/fft-correlate.js';
import { bandpassToProbe } from '../dsp/probe-band.js';
import { estimateCorrelationEvidence } from '../dsp/correlation-evidence.js';
import { findDirectPathTau } from '../calibration/direct-path.js';
import { buildRangeProfileFromCorrelation } from '../dsp/profile.js';
import { estimateBestFromProfile } from '../dsp/peak.js';
import { applyQualityAlgorithms, resolveAutoQualityAlgo } from '../dsp/quality.js';
import type { QualityAlgoName } from '../dsp/quality.js';
import { applyEnvBaseline } from '../dsp/clutter.js';
import { suppressStaticReflections, type ClutterState } from '../dsp/clutter.js';
import {
  ensureNoiseKalmanState,
  guardBackoff,
  subtractNoiseFloor,
  updateNoiseKalman,
  type NoiseKalmanState,
} from '../dsp/noise-floor-kalman.js';
import { applyDisplayReflectionBlanking } from '../dsp/display-reflection-blanking.js';
import { caCfar } from '../dsp/cfar.js';
import { demuxMultiplexProfile } from '../dsp/multiplex-demux.js';
import { computeProfileConfidence } from './confidence.js';
import { buildRangePrior, selectPeakWithRangePrior } from './range-prior.js';
import { computeChirpSubbandStability } from './subband-stability.js';
import { createProbe } from '../signal/probe-factory.js';
import { resumeIfSuspended, getSampleRate } from '../audio/engine.js';
import { pingAndCaptureSteered } from '../spatial/steering.js';
import { computeSteeringDelay } from '../spatial/steering.js';
import { delayAndSum } from '../spatial/rx-beamformer.js';
import { predictedTau0ForPing } from '../calibration/engine.js';
import { updateTrackingFromMeasurement } from '../tracking/engine.js';
import { mahalanobisDistance, DEFAULT_KALMAN_CONFIG } from '../tracking/kalman.js';
import { DEFAULT_MT_CONFIG } from '../tracking/multi-target.js';
import { peerManager } from '../network/peer-manager.js';
import { mergeRemoteAudio } from '../network/distributed-array.js';
import { broadcastCaptureRequest, waitForRemoteCaptures } from '../network/capture-collector.js';
import type { PingDetailedResult, RangeProfile, ArrayGeometry, CaptureResponse, SyncedAudioChunk, Measurement } from '../types.js';

let clutterState: ClutterState = { model: null };
let noiseKalmanState: NoiseKalmanState | null = null;
let nextPingId = 1;

interface PeakCandidate {
  bin: number;
  value: number;
  range: number;
}

function extractTopProfilePeaks(
  profile: Float32Array,
  minR: number,
  maxR: number,
  count = 3,
  minSeparationBins = 3,
): PeakCandidate[] {
  if (profile.length === 0) return [];

  const candidates: PeakCandidate[] = [];
  for (let i = 0; i < profile.length; i++) {
    const value = profile[i];
    if (!(value > 0)) continue;
    const range = profile.length > 1
      ? minR + (i / (profile.length - 1)) * (maxR - minR)
      : minR;
    candidates.push({ bin: i, value, range });
  }

  candidates.sort((a, b) => b.value - a.value);
  const selected: PeakCandidate[] = [];
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    const tooClose = selected.some(p => Math.abs(p.bin - candidate.bin) < minSeparationBins);
    if (!tooClose) selected.push(candidate);
  }
  return selected;
}

function capturesToChunks(captures: CaptureResponse[]): SyncedAudioChunk[] {
  const probeConfig = store.get().config.probe;
  return captures.map(c => ({
    peerId: c.peerId,
    timestamp: c.timestamp,
    sampleRate: c.sampleRate,
    channels: c.channels,
    probeConfig,
  }));
}

export function resetClutter(): void {
  clutterState = { model: null };
  noiseKalmanState = null;
}

export function buildRxGeometry(
  micArraySpacing: number,
  speedOfSound: number,
  channelCount: number,
): ArrayGeometry | null {
  if (channelCount < 2) return null;
  const geom = store.get().geometry;
  const state = store.get();
  const mic = geom.microphones[0] ?? { x: 0, y: 0, z: 0 };

  const micArrayCal = state.calibration?.valid ? state.calibration.micArrayCalibration : undefined;
  if (micArrayCal && micArrayCal.channels.length === channelCount) {
    const sortedChannels = [...micArrayCal.channels].sort((a, b) => a.channelIndex - b.channelIndex);
    return {
      speakers: geom.speakers,
      microphones: sortedChannels.map(ch => ({ x: ch.micPosition.x, y: ch.micPosition.y, z: mic.z })),
      spacing: geom.spacing,
      speedOfSound,
    };
  }

  const localChannelCount = state.audio.channelCount;
  if (state.audio.isRunning && channelCount > localChannelCount) return null;
  if (micArraySpacing <= 0) return null;

  const center = 0.5 * (channelCount - 1);
  const microphones = new Array(channelCount).fill(0).map((_, i) => ({
    x: mic.x + (i - center) * micArraySpacing,
    y: mic.y,
    z: mic.z,
  }));

  return {
    speakers: geom.speakers,
    microphones,
    spacing: geom.spacing,
    speedOfSound,
  };
}

function getRxChannelDelaySec(channelCount: number): number[] | undefined {
  const calib = store.get().calibration;
  if (!calib?.valid) return undefined;
  const micArrayCal = calib.micArrayCalibration;
  if (!micArrayCal || micArrayCal.channels.length !== channelCount) return undefined;

  const sorted = [...micArrayCal.channels].sort((a, b) => a.channelIndex - b.channelIndex);
  if (sorted.some(ch => !ch.valid)) return undefined;
  return sorted.map(ch => ch.relativeDelaySec);
}

function estimateProbeCenterHz(): number {
  const probe = store.get().config.probe;
  if (probe.type === 'chirp') {
    return 0.5 * (probe.params.f1 + probe.params.f2);
  }
  if (probe.type === 'mls') {
    return Math.max(500, 0.5 * probe.params.chipRate);
  }
  if (probe.type === 'golay') {
    return Math.max(500, 0.5 * probe.params.chipRate);
  }
  if (probe.type === 'multiplex') {
    if (probe.params.activeCarrierHz && probe.params.activeCarrierHz.length > 0) {
      const sum = probe.params.activeCarrierHz.reduce((acc, hz) => acc + hz, 0);
      return sum / probe.params.activeCarrierHz.length;
    }
    return 0.5 * (probe.params.fStart + probe.params.fEnd);
  }
  return 4000;
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
  // Bandpass-filter mic to the probe frequency band for correlation.
  // This improves range-profile quality by rejecting out-of-band noise.
  const probeConfig = store.get().config.probe;
  const micFiltered = bandpassToProbe(micWin, probeConfig, sampleRate);

  const corrComplex = fftCorrelateComplex(micFiltered, ref, sampleRate);
  const corrReal = corrComplex.correlation;
  const corrImag = corrComplex.correlationImag;
  // TX evidence uses the FILTERED mic signal so that the energy denominator
  // matches the signal that produced the correlation.  The prominence gate
  // inside estimateCorrelationEvidence rejects in-band noise (prominence 5–8)
  // while real probes produce prominence ≥ 8.
  const txEvidence = estimateCorrelationEvidence(corrReal, micFiltered, ref);
  const refE = signalEnergy(ref);
  energyNormalize(corrReal, refE);
  energyNormalize(corrImag, refE);

  // Debug: correlation stats
  let corrMax = 0, corrMaxIdx = 0, micMax = 0, micFilteredMax = 0;
  for (let i = 0; i < corrReal.length; i++) { const v = Math.abs(corrReal[i]); if (v > corrMax) { corrMax = v; corrMaxIdx = i; } }
  for (let i = 0; i < micWin.length; i++) { const v = Math.abs(micWin[i]); if (v > micMax) micMax = v; }
  for (let i = 0; i < micFiltered.length; i++) { const v = Math.abs(micFiltered[i]); if (v > micFilteredMax) micFilteredMax = v; }
  console.debug(`[corrAndBuild] micLen=${micWin.length} micMax=${micMax.toExponential(3)} micFiltMax=${micFilteredMax.toExponential(3)} refLen=${ref.length} refEnergy=${refE.toExponential(3)} corrLen=${corrReal.length} corrMax=${corrMax.toExponential(3)} corrMaxIdx=${corrMaxIdx} txNorm=${txEvidence.peakNorm.toFixed(3)} txProm=${txEvidence.prominence.toFixed(2)} txWidth=${txEvidence.peakWidth} txPass=${txEvidence.pass} predTau0=${predictedTau0OrNull?.toFixed(6) ?? 'null'}`);

  // Early exit: if TX evidence fails (e.g., mic muted), skip all processing
  if (!txEvidence.pass) {
    const reason = micMax > 0.5 ? 'high ambient noise — try a quieter environment' : 'mic may be muted';
    console.debug(`[corrAndBuild] TX evidence failed — early exit (${reason})`);
    const emptyProf = new Float32Array(heatBins);
    return {
      corrReal: new Float32Array(corrReal.length),
      corrImag: new Float32Array(corrImag.length),
      tau0: 0,
      prof: emptyProf,
      bestBin: -1,
      bestVal: 0,
      bestR: NaN,
      txEvidence,
    };
  }

  const tau0 = findDirectPathTau(corrReal, predictedTau0OrNull, lockStrength, sampleRate);
  console.debug(`[corrAndBuild] tau0=${tau0.toFixed(6)} (${(tau0 * 1000).toFixed(2)}ms, sample=${Math.round(tau0 * sampleRate)})`);

  const prof = buildRangeProfileFromCorrelation(corrReal, tau0, c, minR, maxR, sampleRate, heatBins);
  const best = estimateBestFromProfile(prof, minR, maxR);
  return {
    corrReal,
    corrImag,
    tau0,
    prof,
    bestBin: best.bin,
    bestVal: best.val,
    bestR: best.range,
    txEvidence,
  };
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
  angleDeg: number,
  micArraySpacing: number,
) {
  const config = store.get().config;
  const hasPeers = peerManager.getPeerCount() > 0 && config.distributed.enabled;

  // Golay A
  const pingIdA = nextPingId++;
  if (hasPeers) broadcastCaptureRequest(pingIdA, angleDeg, listenMs, 'golay');

  const capA = await pingAndCaptureSteered(a, dt, gain, listenMs);
  const localTsA = performance.now() / 1000;
  const predTau0A = predictedTau0ForPing(capA.delayL, capA.delayR);

  let micChannelsA = capA.micChannels;
  if (hasPeers) {
    const remotesA = await waitForRemoteCaptures(pingIdA, config.distributed.captureTimeoutMs);
    if (remotesA.length > 0) {
      micChannelsA = mergeRemoteAudio(capA.micChannels, sampleRate, capturesToChunks(remotesA), localTsA);
    }
  }

  await sleep(Math.max(0, gapMs));

  // Golay B
  const pingIdB = nextPingId++;
  if (hasPeers) broadcastCaptureRequest(pingIdB, angleDeg, listenMs, 'golay');

  const capB = await pingAndCaptureSteered(b, dt, gain, listenMs);
  const localTsB = performance.now() / 1000;
  const predTau0B = predictedTau0ForPing(capB.delayL, capB.delayR);

  let micChannelsB = capB.micChannels;
  if (hasPeers) {
    const remotesB = await waitForRemoteCaptures(pingIdB, config.distributed.captureTimeoutMs);
    if (remotesB.length > 0) {
      micChannelsB = mergeRemoteAudio(capB.micChannels, sampleRate, capturesToChunks(remotesB), localTsB);
    }
  }

  // Apply RX beamforming if stereo mic array is configured
  const rxGeo = buildRxGeometry(micArraySpacing, c, micChannelsA.length);
  const rxChannelDelaySec = getRxChannelDelaySec(micChannelsA.length);
  const micARaw = rxGeo ? delayAndSum(micChannelsA, angleDeg, rxGeo, sampleRate, rxChannelDelaySec) : capA.micWin;
  const micBRaw = rxGeo ? delayAndSum(micChannelsB, angleDeg, rxGeo, sampleRate, rxChannelDelaySec) : capB.micWin;

  // Bandpass-filter mic signals to the probe frequency band
  const probeConfig = store.get().config.probe;
  const micA = bandpassToProbe(micARaw, probeConfig, sampleRate);
  const micB = bandpassToProbe(micBRaw, probeConfig, sampleRate);

  // Sum raw correlations WITHOUT per-half normalization to preserve Golay sidelobe cancellation
  const corrA = fftCorrelateComplex(micA, a, sampleRate);
  const corrB = fftCorrelateComplex(micB, b, sampleRate);
  const L = Math.min(corrA.correlation.length, corrB.correlation.length);
  const corrRealSum = new Float32Array(L);
  const corrImagSum = new Float32Array(L);
  for (let i = 0; i < L; i++) {
    corrRealSum[i] = corrA.correlation[i] + corrB.correlation[i];
    corrImagSum[i] = corrA.correlationImag[i] + corrB.correlationImag[i];
  }
  const totalEnergy = signalEnergy(a) + signalEnergy(b);
  energyNormalize(corrRealSum, totalEnergy);
  energyNormalize(corrImagSum, totalEnergy);

  // Debug: Golay correlation stats
  let micMaxA = 0, micMaxB = 0, corrSumMax = 0, corrSumMaxIdx = 0;
  for (let i = 0; i < micA.length; i++) { const v = Math.abs(micA[i]); if (v > micMaxA) micMaxA = v; }
  for (let i = 0; i < micB.length; i++) { const v = Math.abs(micB[i]); if (v > micMaxB) micMaxB = v; }
  for (let i = 0; i < corrRealSum.length; i++) { const v = Math.abs(corrRealSum[i]); if (v > corrSumMax) { corrSumMax = v; corrSumMaxIdx = i; } }
  console.debug(`[golayCorr] micA=${micA.length} micMaxA=${micMaxA.toExponential(3)} micB=${micB.length} micMaxB=${micMaxB.toExponential(3)} totalEnergy=${totalEnergy.toExponential(3)} corrSumLen=${L} corrSumMax=${corrSumMax.toExponential(3)} corrSumMaxIdx=${corrSumMaxIdx}${rxGeo ? ' (RX beamformed)' : ''}`);

  // TX evidence: check each half for signal presence.
  // Uses FILTERED mic signals — energy must match the signal used for correlation.
  const txA = estimateCorrelationEvidence(corrA.correlation, micA, a);
  const txB = estimateCorrelationEvidence(corrB.correlation, micB, b);
  const golayTxEvidence = {
    peakNorm: Math.max(txA.peakNorm, txB.peakNorm),
    medianNorm: (txA.medianNorm + txB.medianNorm) / 2,
    prominence: Math.max(txA.prominence, txB.prominence),
    peakIndex: txA.peakNorm >= txB.peakNorm ? txA.peakIndex : txB.peakIndex,
    // Require BOTH halves to pass — noise randomly passes ~30% per half,
    // so OR gate gives ~50%+ false positive rate. AND gate reduces it to ~9%.
    pass: txA.pass && txB.pass,
  };
  console.debug(`[golayCorr] txA.pass=${txA.pass} txB.pass=${txB.pass} txPass=${golayTxEvidence.pass} peakNorm=${golayTxEvidence.peakNorm.toFixed(4)} prominence=${golayTxEvidence.prominence.toFixed(2)}`);

  // Early exit: if Golay TX evidence fails, skip processing
  if (!golayTxEvidence.pass) {
    console.debug(`[golayCorr] TX evidence failed — early exit (mic may be muted)`);
    return {
      corrReal: new Float32Array(corrRealSum.length),
      corrImag: new Float32Array(corrImagSum.length),
      tau0: 0,
      prof: new Float32Array(heatBins),
      txEvidence: golayTxEvidence,
    };
  }

  let predTau0: number | null = null;
  if (Number.isFinite(predTau0A) && Number.isFinite(predTau0B)) predTau0 = 0.5 * ((predTau0A ?? 0) + (predTau0B ?? 0));
  else if (Number.isFinite(predTau0A)) predTau0 = predTau0A;
  else if (Number.isFinite(predTau0B)) predTau0 = predTau0B;

  const tau0 = findDirectPathTau(corrRealSum, predTau0, lockStrength, sampleRate);
  console.debug(`[golayCorr] tau0=${tau0.toFixed(6)} (${(tau0 * 1000).toFixed(2)}ms) predTau0=${predTau0?.toFixed(6) ?? 'null'}`);

  const prof = buildRangeProfileFromCorrelation(corrRealSum, tau0, c, minR, maxR, sampleRate, heatBins);
  return { corrReal: corrRealSum, corrImag: corrImagSum, tau0, prof, txEvidence: golayTxEvidence };
}

export async function doPingDetailed(
  angleDeg: number,
  updateHeatRowIndex: number | null = null,
): Promise<PingDetailedResult> {
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
  const nowMs = Date.now();

  let corrFinalReal: Float32Array;
  let corrFinalImag: Float32Array;
  let tau0Final: number;
  let profFinal: Float32Array;
  let chirpStabilityInput: { micSignal: Float32Array; ref: Float32Array; f1: number; f2: number } | null = null;
  let txEvidence = { peakNorm: 0, medianNorm: 0, prominence: 0, peakIndex: -1, pass: true };

  bus.emit('ping:start', { angleDeg });

  if (probe.type === 'golay' && probe.a && probe.b) {
    const roundTripMs = (2 * maxR / c) * 1000;
    const minGolayGapMs = Math.ceil(roundTripMs) + 2;
    const effectiveGapMs = Math.max(probe.gapMs ?? 12, minGolayGapMs);
    const golay = await captureGolaySteered(
      probe.a, probe.b, effectiveGapMs,
      dt, gain, listenMs, c, minR, maxR, lockStrength, sr, heatBins,
      angleDeg, config.micArraySpacing,
    );
    corrFinalReal = golay.corrReal;
    corrFinalImag = golay.corrImag;
    tau0Final = golay.tau0;
    profFinal = golay.prof;
    txEvidence = golay.txEvidence;
  } else if (probe.type === 'multiplex' && probe.ref && probe.refsByCarrier && probe.carrierHz) {
    // Distributed: broadcast capture request before local ping
    const muxPingId = nextPingId++;
    const muxHasPeers = peerManager.getPeerCount() > 0 && config.distributed.enabled;
    if (muxHasPeers) {
      broadcastCaptureRequest(muxPingId, angleDeg, listenMs, probe.type);
    }

    const cap = await pingAndCaptureSteered(probe.ref, dt, gain, listenMs);
    const muxLocalTs = performance.now() / 1000;
    const predTau0 = predictedTau0ForPing(cap.delayL, cap.delayR);

    // Merge remote audio if distributed
    let muxMicChannels = cap.micChannels;
    if (muxHasPeers) {
      const muxRemotes = await waitForRemoteCaptures(muxPingId, config.distributed.captureTimeoutMs);
      if (muxRemotes.length > 0) {
        muxMicChannels = mergeRemoteAudio(cap.micChannels, sr, capturesToChunks(muxRemotes), muxLocalTs);
      }
    }

    const rxGeo = buildRxGeometry(config.micArraySpacing, c, muxMicChannels.length);
    const rxChannelDelaySec = getRxChannelDelaySec(muxMicChannels.length);
    const micSignalRaw = rxGeo ? delayAndSum(muxMicChannels, angleDeg, rxGeo, sr, rxChannelDelaySec) : cap.micWin;
    // Bandpass-filter mic to the probe frequency band
    const micSignal = bandpassToProbe(micSignalRaw, config.probe, sr);

    // TX evidence: check if probe was actually transmitted.
    // Uses FILTERED mic signal — energy must match the correlation source.
    const muxTxCorr = fftCorrelateComplex(micSignal, probe.ref, sr);
    txEvidence = estimateCorrelationEvidence(muxTxCorr.correlation, micSignal, probe.ref);
    console.debug(`[doPing:multiplex] txPass=${txEvidence.pass} peakNorm=${txEvidence.peakNorm.toFixed(4)} prominence=${txEvidence.prominence.toFixed(2)}`);

    // Early exit: if TX evidence fails, skip all processing
    if (!txEvidence.pass) {
      console.debug(`[doPing:multiplex] TX evidence failed — early exit (mic may be muted)`);
      const emptyProf = new Float32Array(heatBins);
      const emptyCorr = new Float32Array(1);
      corrFinalReal = emptyCorr;
      corrFinalImag = emptyCorr;
      tau0Final = 0;
      profFinal = emptyProf;
      // Skip to final result emission
      const rangeProfile: RangeProfile = {
        bins: profFinal,
        minRange: minR,
        maxRange: maxR,
        binCount: heatBins,
        bestBin: -1,
        bestRange: NaN,
        bestStrength: 0,
      };
      bus.emit('ping:complete', { angleDeg, profile: rangeProfile });
      return { profile: rangeProfile, rawFrame: { angleDeg, sampleRate: sr, tau0: tau0Final, corrReal: corrFinalReal, corrImag: corrFinalImag, centerFreqHz: estimateProbeCenterHz(), quality: 0 } };
    }

    const muxCfg = config.probe.type === 'multiplex' ? config.probe.params : null;
    const demux = demuxMultiplexProfile({
      signal: micSignal,
      refsByCarrier: probe.refsByCarrier,
      carrierHz: probe.carrierHz,
      fusion: muxCfg?.fusion ?? 'snrWeighted',
      trimFraction: config.scanTrimFraction,
      c,
      minR,
      maxR,
      sampleRate: sr,
      heatBins,
      predictedTau0: predTau0,
      lockStrength,
      carrierWeights: muxCfg?.carrierWeights,
    });

    corrFinalReal = demux.corrReal;
    corrFinalImag = demux.corrImag;
    tau0Final = demux.tau0;
    profFinal = demux.profile;

    const muxBest = estimateBestFromProfile(profFinal, minR, maxR);
    const muxConf = computeProfileConfidence(profFinal, muxBest.bin, muxBest.val);
    const fallbackEnabled = !!muxCfg?.fallbackToChirp;
    const lowCarrierSupport = demux.debug.activeCarrierCount < Math.max(2, Math.floor((probe.carrierHz.length || 1) / 2));
    const lowConfidence = muxConf.confidence < Math.min(config.confidenceGate * 0.8, 0.24);

    if (fallbackEnabled && (lowCarrierSupport || lowConfidence)) {
      const chirpProbe = createProbe({
        type: 'chirp',
        params: {
          f1: Math.min(muxCfg?.fStart ?? 2000, muxCfg?.fEnd ?? 9000),
          f2: Math.max(muxCfg?.fStart ?? 2000, muxCfg?.fEnd ?? 9000),
          durationMs: Math.max(4, muxCfg?.symbolMs ?? 8),
        },
      }, sr);

      if (chirpProbe.ref) {
        const fallbackCap = await pingAndCaptureSteered(chirpProbe.ref, dt, gain, listenMs);
        const fallbackTau0 = predictedTau0ForPing(fallbackCap.delayL, fallbackCap.delayR);
        const fallbackSignal = rxGeo ? delayAndSum(fallbackCap.micChannels, angleDeg, rxGeo, sr, rxChannelDelaySec) : fallbackCap.micWin;
        const fallback = corrAndBuildProfile(
          fallbackSignal,
          chirpProbe.ref,
          c,
          minR,
          maxR,
          fallbackTau0,
          lockStrength,
          sr,
          heatBins,
        );
        corrFinalReal = fallback.corrReal;
        corrFinalImag = fallback.corrImag;
        tau0Final = fallback.tau0;
        profFinal = fallback.prof;
        txEvidence = fallback.txEvidence;
        console.warn(`[doPing:multiplex] fallback->chirp triggered angle=${angleDeg} activeCarrierCount=${demux.debug.activeCarrierCount} conf=${muxConf.confidence.toFixed(3)}`);
      }
    }
  } else {
    const ref = probe.ref!;

    // Distributed: broadcast capture request before local ping
    const pingId = nextPingId++;
    const hasPeers = peerManager.getPeerCount() > 0 && config.distributed.enabled;
    if (hasPeers) {
      broadcastCaptureRequest(pingId, angleDeg, listenMs, probe.type);
    }

    const cap = await pingAndCaptureSteered(ref, dt, gain, listenMs);
    const localTs = performance.now() / 1000;
    const predTau0 = predictedTau0ForPing(cap.delayL, cap.delayR);

    // Merge remote audio if distributed
    let micChannels = cap.micChannels;
    if (hasPeers) {
      const remoteCaptures = await waitForRemoteCaptures(pingId, config.distributed.captureTimeoutMs);
      if (remoteCaptures.length > 0) {
        micChannels = mergeRemoteAudio(cap.micChannels, sr, capturesToChunks(remoteCaptures), localTs);
      }
    }

    // Apply RX beamforming if stereo mic array is configured
    const rxGeo = buildRxGeometry(config.micArraySpacing, c, micChannels.length);
    const rxChannelDelaySec = getRxChannelDelaySec(micChannels.length);
    const micSignalRaw = rxGeo ? delayAndSum(micChannels, angleDeg, rxGeo, sr, rxChannelDelaySec) : cap.micWin;
    // Keep unfiltered signal reference for TX evidence denominator
    if (probe.type === 'chirp' && config.probe.type === 'chirp') {
      // Use filtered signal for stability analysis (needs in-band content)
      const micSignalForStability = bandpassToProbe(micSignalRaw, config.probe, sr);
      chirpStabilityInput = {
        micSignal: micSignalForStability,
        ref,
        f1: config.probe.params.f1,
        f2: config.probe.params.f2,
      };
    }

    // Pass RAW (unfiltered) signal — corrAndBuildProfile handles bandpass internally
    // and uses the unfiltered signal for TX evidence energy denominator.
    const res = corrAndBuildProfile(micSignalRaw, ref, c, minR, maxR, predTau0, lockStrength, sr, heatBins);
    corrFinalReal = res.corrReal;
    corrFinalImag = res.corrImag;
    tau0Final = res.tau0;
    profFinal = res.prof;
    txEvidence = res.txEvidence;
  }

  // Debug: raw profile stats
  let rawMax = 0;
  {
    let rawNZ = 0;
    for (let i = 0; i < profFinal.length; i++) { if (profFinal[i] > rawMax) rawMax = profFinal[i]; if (profFinal[i] > 1e-15) rawNZ++; }
    console.debug(`[doPing:raw] angle=${angleDeg} rawMax=${rawMax.toExponential(3)} nonZero=${rawNZ}/${profFinal.length}`);
  }

  if (config.displayReflectionBlanking.enabled) {
    profFinal = applyDisplayReflectionBlanking(
      profFinal,
      minR,
      maxR,
      config.displayReflectionBlanking,
    );
    let dMax = 0, dNZ = 0;
    for (let i = 0; i < profFinal.length; i++) { if (profFinal[i] > dMax) dMax = profFinal[i]; if (profFinal[i] > 1e-15) dNZ++; }
    console.debug(`[doPing:displayBlank] max=${dMax.toExponential(3)} nonZero=${dNZ}/${profFinal.length}`);
  }

  // Apply env baseline
  const envBaseline = state.calibration?.envBaseline ?? null;
  if (config.envBaseline.enabled) {
    const beforeBaseline = profFinal;
    profFinal = applyEnvBaseline(
      profFinal,
      envBaseline,
      config.envBaseline.strength,
      config.subtractionBackoff,
    );
    let eMax = 0, eNZ = 0;
    for (let i = 0; i < profFinal.length; i++) { if (profFinal[i] > eMax) eMax = profFinal[i]; if (profFinal[i] > 1e-15) eNZ++; }
    console.debug(`[doPing:envBaseline] max=${eMax.toExponential(3)} nonZero=${eNZ}/${profFinal.length}`);
    // Safeguard: if envBaseline removed ALL signal but raw had data, fall back
    if (eMax < 1e-15 && rawMax > 1e-15) {
      console.warn('[doPing] envBaseline zeroed out entire profile — falling back to raw profile');
      profFinal = beforeBaseline;
    }
  }

  // Apply per-bin noise-floor Kalman during scanning
  if (updateHeatRowIndex !== null && config.noiseKalman.enabled) {
    noiseKalmanState = ensureNoiseKalmanState(
      noiseKalmanState,
      profFinal.length,
      config.noiseKalman.minFloor,
    );

    const preKalmanBest = estimateBestFromProfile(profFinal, minR, maxR);
    const preKalmanConf = computeProfileConfidence(profFinal, preKalmanBest.bin, preKalmanBest.val);
    const freeze = config.noiseKalman.freezeOnHighConfidence
      && preKalmanConf.confidence >= config.noiseKalman.highConfidenceGate;

    const kalmanUpdate = updateNoiseKalman(noiseKalmanState, profFinal, {
      q: config.noiseKalman.processNoiseQ,
      r: config.noiseKalman.measurementNoiseR,
      freeze,
      minFloor: config.noiseKalman.minFloor,
      maxFloor: config.noiseKalman.maxFloor,
    });

    const kalmanSubtracted = subtractNoiseFloor(
      profFinal,
      noiseKalmanState,
      config.noiseKalman.subtractStrength,
      config.noiseKalman.minFloor,
      config.noiseKalman.maxFloor,
    );

    const kalmanBackoff = guardBackoff(profFinal, kalmanSubtracted, config.subtractionBackoff);
    profFinal = kalmanBackoff.profile;

    let nkMax = 0, nkNZ = 0;
    for (let i = 0; i < profFinal.length; i++) {
      if (profFinal[i] > nkMax) nkMax = profFinal[i];
      if (profFinal[i] > 1e-15) nkNZ++;
    }
    console.debug(`[doPing:noiseKalman] freeze=${freeze} updBins=${kalmanUpdate.updatedBins} meanK=${kalmanUpdate.meanGain.toFixed(4)} backoff=${kalmanBackoff.backoffLevel.toFixed(3)} max=${nkMax.toExponential(3)} nonZero=${nkNZ}/${profFinal.length}`);
  }

  // Apply static clutter suppression during scanning
  if (updateHeatRowIndex !== null && config.clutterSuppression.enabled) {
    // Compute preliminary confidence before clutter suppression for adaptive novelty
    const preclutterBest = estimateBestFromProfile(profFinal, minR, maxR);
    const preclutterConf = computeProfileConfidence(profFinal, preclutterBest.bin, preclutterBest.val);
    const result = suppressStaticReflections(profFinal, clutterState, config.clutterSuppression.strength, {
      backoff: config.subtractionBackoff,
      selectiveUpdate: { enabled: true, noveltyRatio: 0.35, adaptiveNovelty: true, confidence: preclutterConf.confidence },
    });
    profFinal = result.profile;
    clutterState = result.clutterState;
    let cMax = 0, cNZ = 0;
    for (let i = 0; i < profFinal.length; i++) { if (profFinal[i] > cMax) cMax = profFinal[i]; if (profFinal[i] > 1e-15) cNZ++; }
    console.debug(`[doPing:clutter] max=${cMax.toExponential(3)} nonZero=${cNZ}/${profFinal.length}`);
  }

  // Apply quality algorithms
  let algoName: QualityAlgoName = config.qualityAlgo === 'auto' ? 'balanced' : config.qualityAlgo;
  let autoSwitched = false;
  if (config.qualityAlgo === 'auto') {
    const resolved = resolveAutoQualityAlgo(profFinal, state.qualityPerf, nowMs, {
      enabled: config.adaptiveQuality.enabled,
      hysteresisMs: config.adaptiveQuality.hysteresisMs,
    });
    algoName = resolved.resolved;
    autoSwitched = resolved.switched;
    console.debug(`[doPing:autoQuality] resolved=${algoName} psr=${resolved.stats.psr.toFixed(2)} snrDb=${resolved.stats.snrDb.toFixed(2)} switched=${autoSwitched}`);
  }
  profFinal = applyQualityAlgorithms(profFinal, algoName);
  {
    let qMax = 0, qNZ = 0;
    for (let i = 0; i < profFinal.length; i++) { if (profFinal[i] > qMax) qMax = profFinal[i]; if (profFinal[i] > 1e-15) qNZ++; }
    console.debug(`[doPing:quality] algo=${algoName} max=${qMax.toExponential(3)} nonZero=${qNZ}/${profFinal.length}`);
  }

  const bestPost = estimateBestFromProfile(profFinal, minR, maxR);
  let bestBin = bestPost.bin;
  let bestVal = bestPost.val;
  let bestR = bestPost.range;
  const topPeaks = extractTopProfilePeaks(
    profFinal,
    minR,
    maxR,
    3,
    Math.max(2, Math.floor(profFinal.length * 0.015)),
  );
  const rangePrior = buildRangePrior(state.targets, state.lastTarget.range, minR, maxR);
  const mapPeak = selectPeakWithRangePrior(topPeaks, rangePrior);
  if (mapPeak) {
    bestBin = mapPeak.bin;
    bestVal = mapPeak.value;
    bestR = mapPeak.range;
  }

  // --- Simplified detection scoring ---
  // Replaces ~15 boolean spaghetti variables with a single weighted score.
  // Detection passes when score >= 1.0 (normalized threshold).

  const edgeBinMargin = Math.max(3, Math.floor(profFinal.length * 0.02));
  const isEdgePeak = bestBin >= 0
    && (bestBin <= edgeBinMargin || bestBin >= (profFinal.length - 1 - edgeBinMargin));

  const confBase = computeProfileConfidence(profFinal, bestBin, bestVal);
  const subbandStability =
    chirpStabilityInput && bestBin >= 0
      ? computeChirpSubbandStability({
        micSignal: chirpStabilityInput.micSignal,
        ref: chirpStabilityInput.ref,
        tau0: tau0Final,
        c,
        minR,
        maxR,
        sampleRate: sr,
        heatBins,
        bestBin,
        f1: chirpStabilityInput.f1,
        f2: chirpStabilityInput.f2,
      })
      : null;
  const confidenceBoost = subbandStability?.confidenceBoost ?? 0;
  const conf = confidenceBoost > 0
    ? { ...confBase, confidence: Math.min(1, confBase.confidence + confidenceBoost) }
    : confBase;

  const cfarResult = caCfar(profFinal, config.cfar);
  const cfarDetected = bestBin >= 0 && cfarResult.detections[bestBin] === 1;
  const cfarThresholdAtBest = bestBin >= 0 && bestBin < cfarResult.thresholds.length
    ? cfarResult.thresholds[bestBin] : NaN;
  const cfarRatioAtBest = Number.isFinite(cfarThresholdAtBest) && cfarThresholdAtBest > 0
    ? bestVal / cfarThresholdAtBest : NaN;

  // Mahalanobis distance to nearest tracked target
  let bestTrackMd = NaN;
  if (state.targets.length > 0 && Number.isFinite(bestR) && bestBin >= 0) {
    const measurement: Measurement = { range: bestR, angleDeg, strength: bestVal, timestamp: nowMs };
    for (const target of state.targets) {
      const md = mahalanobisDistance(target, measurement, DEFAULT_KALMAN_CONFIG);
      if (!Number.isFinite(bestTrackMd) || md < bestTrackMd) bestTrackMd = md;
    }
  }

  // Compute a single detection score from weighted factors.
  // Each factor contributes 0..1; core factors (conf+strength+cfar) sum to 0.80.
  // Detection passes when score >= 0.55 (first ping without tracking can reach ~0.83).
  const confidenceGateEff = config.probe.type !== 'chirp'
    ? Math.min(config.confidenceGate, 0.14)
    : config.confidenceGate;

  const confScore = Math.min(1, conf.confidence / Math.max(0.01, confidenceGateEff));
  const strengthScore = Math.min(1, bestVal / Math.max(1e-12, strengthGate));
  const cfarScore = cfarDetected ? 1.0
    : Number.isFinite(cfarRatioAtBest) ? Math.min(1, cfarRatioAtBest) : 0;
  const trackScore = Number.isFinite(bestTrackMd)
    ? Math.max(0, 1 - bestTrackMd / (DEFAULT_MT_CONFIG.gatingThreshold * 1.5))
    : 0;
  const priorScore = mapPeak
    ? Math.max(0, 1 - mapPeak.zScore / 2.0)
    : 0.3; // no prior = neutral
  const edgePenalty = isEdgePeak ? 0.4 : 0;

  // Weighted detection score: needs >= 0.55 to pass.
  // Core factors alone (conf+strength+cfar) max out at 0.80,
  // so the threshold must be below that to allow first-ping detection
  // before any tracking history exists.
  const detectionScore =
    0.30 * confScore +
    0.25 * strengthScore +
    0.25 * cfarScore +
    0.10 * trackScore +
    0.10 * priorScore -
    edgePenalty;

  const isWeak = !(bestBin >= 0) || !txEvidence.pass || detectionScore < 0.55;
  const trackingCandidate = Number.isFinite(bestR)
    && bestBin >= 0
    && txEvidence.pass
    && detectionScore >= 0.50;

  const topPeaksText = topPeaks
    .map((p, idx) => `#${idx + 1}@b${p.bin}/r${p.range.toFixed(2)}m/v${p.value.toExponential(2)}`)
    .join(' ');

  console.debug(
    `[rangeDet] a=${angleDeg} bin=${bestBin} r=${Number.isFinite(bestR) ? bestR.toFixed(3) : 'NaN'}m ` +
    `v=${bestVal.toExponential(3)} conf=${conf.confidence.toFixed(3)} cfar=${cfarDetected} ` +
    `cfarR=${Number.isFinite(cfarRatioAtBest) ? cfarRatioAtBest.toFixed(2) : '-'} ` +
    `score=${detectionScore.toFixed(3)} tx=${txEvidence.pass} edge=${isEdgePeak} ` +
    `weak=${isWeak} peaks=[${topPeaksText}]`,
  );

  const trackingRange = bestR;
  const trackingStrength = bestVal;
  if (isWeak) {
    bestBin = -1;
    bestVal = 0;
    bestR = NaN;
    profFinal = new Float32Array(profFinal.length);
    corrFinalReal = new Float32Array(corrFinalReal.length);
  }

  // Update store
  store.update(s => {
    if (config.qualityAlgo === 'auto') {
      s.qualityPerf.lastResolved = algoName;
      if (autoSwitched || s.qualityPerf.lastSwitchAt <= 0) {
        s.qualityPerf.lastSwitchAt = nowMs;
      }
    }

    // During scanning, don't overwrite lastProfile on every ping—
    // it causes the profile plot to show whichever angle was last pinged
    // rather than the best detection.  Scan completion sets it from the
    // consensus direction.
    if (updateHeatRowIndex === null) {
      s.lastProfile.corr = corrFinalReal;
      s.lastProfile.tau0 = tau0Final;
      s.lastProfile.c = c;
      s.lastProfile.minR = minR;
      s.lastProfile.maxR = maxR;
    }

    if (!isWeak && Number.isFinite(bestR)) {
      if (updateHeatRowIndex === null) {
        // Single-ping mode: always update.
        s.lastTarget.angle = angleDeg;
        s.lastTarget.range = bestR;
        s.lastTarget.strength = bestVal;
      }
      // During scanning: don't update lastTarget per-ping.
      // The scan engine computes a consensus direction at the end and
      // sets lastTarget from that — per-ping updates caused the target
      // to jump between angles as stronger pings arrived.
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

  if (updateHeatRowIndex === null) {
    if (trackingCandidate && Number.isFinite(trackingRange)) {
      updateTrackingFromMeasurement({
        range: trackingRange,
        angleDeg,
        strength: trackingStrength,
        timestamp: nowMs,
      }, nowMs);
    } else {
      updateTrackingFromMeasurement(null, nowMs);
    }
  }

  // Debug: log profile stats before emitting
  let profMin = Infinity, profMax = -Infinity, profNonZero = 0;
  for (let i = 0; i < profFinal.length; i++) {
    if (profFinal[i] < profMin) profMin = profFinal[i];
    if (profFinal[i] > profMax) profMax = profFinal[i];
    if (profFinal[i] > 1e-15) profNonZero++;
  }
  console.debug(`[doPing] angle=${angleDeg} profLen=${profFinal.length} profMin=${profMin.toExponential(3)} profMax=${profMax.toExponential(3)} nonZero=${profNonZero}/${profFinal.length} bestBin=${bestBin} bestVal=${bestVal.toExponential(3)} bestR=${bestR.toFixed(3)} isWeak=${isWeak} tau0=${tau0Final.toFixed(6)}`);

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
  const rawFrame = {
    angleDeg,
    sampleRate: sr,
    tau0: tau0Final,
    corrReal: corrFinalReal,
    corrImag: corrFinalImag,
    centerFreqHz: estimateProbeCenterHz(),
    quality: bestPost.val,
  };

  return { profile: rangeProfile, rawFrame };
}

export async function doPing(
  angleDeg: number,
  updateHeatRowIndex: number | null = null,
): Promise<RangeProfile> {
  const detailed = await doPingDetailed(angleDeg, updateHeatRowIndex);
  return detailed.profile;
}
