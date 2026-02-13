import { store } from '../core/store.js';
import { bus } from '../core/event-bus.js';
import { sleep } from '../utils.js';
import { fftCorrelateComplex } from '../dsp/fft-correlate.js';
import { findDirectPathTau } from '../calibration/direct-path.js';
import { buildRangeProfileFromCorrelation } from '../dsp/profile.js';
import { estimateBestFromProfile } from '../dsp/peak.js';
import { applyQualityAlgorithms, resolveAutoQualityAlgo } from '../dsp/quality.js';
import type { QualityAlgoName } from '../dsp/quality.js';
import { applyEnvBaseline } from '../dsp/clutter.js';
import { suppressStaticReflections, type ClutterState } from '../dsp/clutter.js';
import { applyDisplayReflectionBlanking } from '../dsp/display-reflection-blanking.js';
import { caCfar } from '../dsp/cfar.js';
import { demuxMultiplexProfile } from '../dsp/multiplex-demux.js';
import { computeProfileConfidence } from './confidence.js';
import { createProbe } from '../signal/probe-factory.js';
import { resumeIfSuspended, getSampleRate } from '../audio/engine.js';
import { pingAndCaptureSteered } from '../spatial/steering.js';
import { computeSteeringDelay } from '../spatial/steering.js';
import { delayAndSum } from '../spatial/rx-beamformer.js';
import { predictedTau0ForPing } from '../calibration/engine.js';
import { updateTrackingFromMeasurement } from '../tracking/engine.js';
import { peerManager } from '../network/peer-manager.js';
import { mergeRemoteAudio } from '../network/distributed-array.js';
import { broadcastCaptureRequest, waitForRemoteCaptures } from '../network/capture-collector.js';
import type { PingDetailedResult, RangeProfile, ArrayGeometry, CaptureResponse, SyncedAudioChunk } from '../types.js';

let clutterState: ClutterState = { model: null };
let nextPingId = 1;

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
}

export function buildRxGeometry(micArraySpacing: number, speedOfSound: number): ArrayGeometry | null {
  if (micArraySpacing <= 0) return null;
  const geom = store.get().geometry;
  const mic = geom.microphones[0] ?? { x: 0, y: 0, z: 0 };
  const half = micArraySpacing / 2;
  return {
    speakers: geom.speakers,
    microphones: [
      { x: mic.x - half, y: mic.y, z: mic.z },
      { x: mic.x + half, y: mic.y, z: mic.z },
    ],
    spacing: geom.spacing,
    speedOfSound,
  };
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
  const corrComplex = fftCorrelateComplex(micWin, ref, sampleRate);
  const corrReal = corrComplex.correlation;
  const corrImag = corrComplex.correlationImag;
  const refE = signalEnergy(ref);
  energyNormalize(corrReal, refE);
  energyNormalize(corrImag, refE);

  // Debug: correlation stats
  let corrMax = 0, corrMaxIdx = 0, micMax = 0;
  for (let i = 0; i < corrReal.length; i++) { const v = Math.abs(corrReal[i]); if (v > corrMax) { corrMax = v; corrMaxIdx = i; } }
  for (let i = 0; i < micWin.length; i++) { const v = Math.abs(micWin[i]); if (v > micMax) micMax = v; }
  console.log(`[corrAndBuild] micLen=${micWin.length} micMax=${micMax.toExponential(3)} refLen=${ref.length} refEnergy=${refE.toExponential(3)} corrLen=${corrReal.length} corrMax=${corrMax.toExponential(3)} corrMaxIdx=${corrMaxIdx} predTau0=${predictedTau0OrNull?.toFixed(6) ?? 'null'}`);

  const tau0 = findDirectPathTau(corrReal, predictedTau0OrNull, lockStrength, sampleRate);
  console.log(`[corrAndBuild] tau0=${tau0.toFixed(6)} (${(tau0 * 1000).toFixed(2)}ms, sample=${Math.round(tau0 * sampleRate)})`);

  const prof = buildRangeProfileFromCorrelation(corrReal, tau0, c, minR, maxR, sampleRate, heatBins);
  const best = estimateBestFromProfile(prof, minR, maxR);
  return { corrReal, corrImag, tau0, prof, bestBin: best.bin, bestVal: best.val, bestR: best.range };
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
  const rxGeo = buildRxGeometry(micArraySpacing, c);
  const micA = rxGeo ? delayAndSum(micChannelsA, angleDeg, rxGeo, sampleRate) : capA.micWin;
  const micB = rxGeo ? delayAndSum(micChannelsB, angleDeg, rxGeo, sampleRate) : capB.micWin;

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
  console.log(`[golayCorr] micA=${micA.length} micMaxA=${micMaxA.toExponential(3)} micB=${micB.length} micMaxB=${micMaxB.toExponential(3)} totalEnergy=${totalEnergy.toExponential(3)} corrSumLen=${L} corrSumMax=${corrSumMax.toExponential(3)} corrSumMaxIdx=${corrSumMaxIdx}${rxGeo ? ' (RX beamformed)' : ''}`);

  let predTau0: number | null = null;
  if (Number.isFinite(predTau0A) && Number.isFinite(predTau0B)) predTau0 = 0.5 * ((predTau0A ?? 0) + (predTau0B ?? 0));
  else if (Number.isFinite(predTau0A)) predTau0 = predTau0A;
  else if (Number.isFinite(predTau0B)) predTau0 = predTau0B;

  const tau0 = findDirectPathTau(corrRealSum, predTau0, lockStrength, sampleRate);
  console.log(`[golayCorr] tau0=${tau0.toFixed(6)} (${(tau0 * 1000).toFixed(2)}ms) predTau0=${predTau0?.toFixed(6) ?? 'null'}`);

  const prof = buildRangeProfileFromCorrelation(corrRealSum, tau0, c, minR, maxR, sampleRate, heatBins);
  return { corrReal: corrRealSum, corrImag: corrImagSum, tau0, prof };
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

    const rxGeo = buildRxGeometry(config.micArraySpacing, c);
    const micSignal = rxGeo ? delayAndSum(muxMicChannels, angleDeg, rxGeo, sr) : cap.micWin;

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
        const fallbackSignal = rxGeo ? delayAndSum(fallbackCap.micChannels, angleDeg, rxGeo, sr) : fallbackCap.micWin;
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
    const rxGeo = buildRxGeometry(config.micArraySpacing, c);
    const micSignal = rxGeo ? delayAndSum(micChannels, angleDeg, rxGeo, sr) : cap.micWin;

    const res = corrAndBuildProfile(micSignal, ref, c, minR, maxR, predTau0, lockStrength, sr, heatBins);
    corrFinalReal = res.corrReal;
    corrFinalImag = res.corrImag;
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

  if (config.displayReflectionBlanking.enabled) {
    profFinal = applyDisplayReflectionBlanking(
      profFinal,
      minR,
      maxR,
      config.displayReflectionBlanking,
    );
    let dMax = 0, dNZ = 0;
    for (let i = 0; i < profFinal.length; i++) { if (profFinal[i] > dMax) dMax = profFinal[i]; if (profFinal[i] > 1e-15) dNZ++; }
    console.log(`[doPing:displayBlank] max=${dMax.toExponential(3)} nonZero=${dNZ}/${profFinal.length}`);
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
    console.log(`[doPing:envBaseline] max=${eMax.toExponential(3)} nonZero=${eNZ}/${profFinal.length}`);
    // Safeguard: if envBaseline removed ALL signal but raw had data, fall back
    if (eMax < 1e-15 && rawMax > 1e-15) {
      console.warn('[doPing] envBaseline zeroed out entire profile — falling back to raw profile');
      profFinal = beforeBaseline;
    }
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
    console.log(`[doPing:clutter] max=${cMax.toExponential(3)} nonZero=${cNZ}/${profFinal.length}`);
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
    console.log(`[doPing:autoQuality] resolved=${algoName} psr=${resolved.stats.psr.toFixed(2)} snrDb=${resolved.stats.snrDb.toFixed(2)} switched=${autoSwitched}`);
  }
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

  const conf = computeProfileConfidence(profFinal, bestBin, bestVal);
  const cfarResult = caCfar(profFinal, config.cfar);
  const cfarDetected = bestBin >= 0 && cfarResult.detections[bestBin] === 1;
  const isWeak = !cfarDetected || conf.confidence < config.confidenceGate;
  console.log(`[doPing:gate] bestVal=${bestVal.toExponential(3)} strengthGate=${strengthGate} confidence=${conf.confidence.toFixed(3)} confidenceGate=${config.confidenceGate.toFixed(3)} cfarDetected=${cfarDetected} isWeak=${isWeak}`);
  if (isWeak) {
    bestBin = -1;
    bestVal = 0;
    bestR = NaN;
  }

  // Update store
  store.update(s => {
    if (config.qualityAlgo === 'auto') {
      s.qualityPerf.lastResolved = algoName;
      if (autoSwitched || s.qualityPerf.lastSwitchAt <= 0) {
        s.qualityPerf.lastSwitchAt = nowMs;
      }
    }

    s.lastProfile.corr = corrFinalReal;
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

  if (updateHeatRowIndex === null) {
    if (!isWeak && Number.isFinite(bestR)) {
      updateTrackingFromMeasurement({
        range: bestR,
        angleDeg,
        strength: bestVal,
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
