import { store } from '../core/store.js';
import { clamp } from '../utils.js';
import { speedOfSoundFromTemp, DEFAULT_CHIRP, DEFAULT_GOLAY, DEFAULT_MLS, DEFAULT_MULTIPLEX } from '../constants.js';
import type { ProbeConfig, ColormapName, MultiplexConfig } from '../types.js';

export interface DerivedConfig {
  speedOfSound: number;
  listenMs: number;
  minRange: number;
  scanDwell: number;
  minGolayGapMs: number;
}

export function computeDerivedConfig(
  temperature: number,
  maxRange: number,
  spacing: number,
): DerivedConfig {
  const speedOfSound = speedOfSoundFromTemp(temperature);
  const safeMaxRange = Math.max(0, maxRange);
  const listenMs = (2 * safeMaxRange / speedOfSound) * 1000 + 50;
  const minRange = Math.max(0.3, spacing + 0.05);
  const scanDwell = listenMs;
  const minGolayGapMs = Math.ceil((2 * safeMaxRange / speedOfSound) * 1000) + 2;
  return { speedOfSound, listenMs, minRange, scanDwell, minGolayGapMs };
}

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function inputVal(id: string, fallback = 0): number {
  const v = parseFloat((el(id) as HTMLInputElement)?.value ?? '');
  return Number.isFinite(v) ? v : fallback;
}

function selectVal(id: string): string {
  return (el(id) as HTMLSelectElement)?.value ?? '';
}

function checkVal(id: string): boolean {
  return (el(id) as HTMLInputElement)?.checked ?? false;
}

function setVal(id: string, value: string): void {
  const node = el(id) as HTMLInputElement | HTMLSelectElement | null;
  if (node) node.value = value;
}

function setChecked(id: string, checked: boolean): void {
  const node = el(id) as HTMLInputElement | null;
  if (node) node.checked = checked;
}

export function syncDOMFromConfig(): void {
  const state = store.get();
  const config = state.config;

  setVal('mode', config.probe.type);
  setVal('devicePreset', config.devicePreset);
  setChecked('presetApplyScan', config.presetApplyScan);
  setVal('angle', `${config.steeringAngleDeg}`);
  const angleValEl = el('angleVal');
  if (angleValEl) angleValEl.textContent = `${config.steeringAngleDeg}`;

  setVal('spacing', `${config.spacing}`);
  setVal('micArraySpacing', `${config.micArraySpacing}`);
  setVal('temperature', `${config.temperature}`);
  setVal('gain', `${config.gain}`);
  setVal('maxR', `${config.maxRange}`);

  const chirpParams = config.probe.type === 'chirp' ? config.probe.params : DEFAULT_CHIRP;
  setVal('f1', `${chirpParams.f1}`);
  setVal('f2', `${chirpParams.f2}`);
  setVal('T', `${chirpParams.durationMs}`);

  const mlsParams = config.probe.type === 'mls' ? config.probe.params : DEFAULT_MLS;
  setVal('mlsOrder', `${mlsParams.order}`);
  setVal('chipRate', `${mlsParams.chipRate}`);

  const golayParams = config.probe.type === 'golay' ? config.probe.params : DEFAULT_GOLAY;
  setVal('golayOrder', `${golayParams.order}`);
  setVal('golayChipRate', `${golayParams.chipRate}`);
  setVal('golayGapMs', `${golayParams.gapMs}`);

  const multiplexParams: MultiplexConfig = config.probe.type === 'multiplex'
    ? config.probe.params
    : {
      ...DEFAULT_MULTIPLEX,
      useCalibrated: true,
      fallbackToChirp: true,
    };
  setVal('multiplexCarrierCount', `${multiplexParams.carrierCount}`);
  setVal('multiplexFStart', `${multiplexParams.fStart}`);
  setVal('multiplexFEnd', `${multiplexParams.fEnd}`);
  setVal('multiplexSymbolMs', `${multiplexParams.symbolMs}`);
  setVal('multiplexGuardHz', `${multiplexParams.guardHz}`);
  setVal('multiplexMinSpacingHz', `${multiplexParams.minSpacingHz}`);
  setVal('multiplexCalibrationCandidates', `${multiplexParams.calibrationCandidates}`);
  setVal('multiplexFusion', `${multiplexParams.fusion}`);
  setChecked('multiplexUseCalibrated', multiplexParams.useCalibrated ?? true);
  setChecked('multiplexFallbackToChirp', multiplexParams.fallbackToChirp ?? true);

  setVal('scanStep', `${config.scanStep}`);
  setVal('scanPasses', `${config.scanPasses}`);
  setVal('dirAxis', `${config.directionAxis}`);

  setVal('strengthGate', `${config.strengthGate}`);
  setVal('confidenceGate', `${config.confidenceGate}`);
  setChecked('scanClutterOn', config.clutterSuppression.enabled);
  setVal('scanClutterStrength', `${config.clutterSuppression.strength}`);
  setVal('qualityAlgo', `${config.qualityAlgo}`);
  setVal('scanAggregateMode', `${config.scanAggregateMode}`);
  setVal('scanTrimFraction', `${config.scanTrimFraction}`);
  setVal('temporalIirAlpha', `${config.temporalIirAlpha}`);
  setVal('outlierHistoryN', `${config.outlierHistoryN}`);
  setVal('continuityBins', `${config.continuityBins}`);
  setChecked('adaptiveQualityOn', config.adaptiveQuality.enabled);
  setVal('adaptiveQualityHysteresisMs', `${config.adaptiveQuality.hysteresisMs}`);
  setChecked('subtractionBackoffOn', config.subtractionBackoff.enabled);
  setVal('subtractionCollapseThreshold', `${config.subtractionBackoff.collapseThreshold}`);
  setVal('subtractionPeakDropThreshold', `${config.subtractionBackoff.peakDropThreshold}`);

  setChecked('displayBlankingOn', config.displayReflectionBlanking.enabled);
  setVal('displayBlankingStartRange', `${config.displayReflectionBlanking.startRange}`);
  setVal('displayBlankingEndRange', `${config.displayReflectionBlanking.endRange}`);
  setVal('displayBlankingAttenuation', `${config.displayReflectionBlanking.attenuation}`);
  setVal('displayBlankingEdgeSoftness', `${config.displayReflectionBlanking.edgeSoftness}`);

  setVal('trackTrailMaxPoints', `${config.trackViz.trailMaxPoints}`);
  setVal('trackFadeMissCount', `${config.trackViz.fadeMissCount}`);
  setVal('trackTrailMinAlpha', `${config.trackViz.trailMinAlpha}`);
  setVal('trackTrailMaxAlpha', `${config.trackViz.trailMaxAlpha}`);
  setVal('trackMinConfidenceFloor', `${config.trackViz.minConfidenceFloor}`);

  setChecked('useCalib', config.calibration.useCalib);
  setChecked('useMultiband', config.calibration.multiband);
  setChecked('showTrace', config.showTrace);
  setVal('calRepeats', `${config.calibration.repeats}`);
  setVal('calRepeatGapMs', `${config.calibration.gapMs}`);

  setChecked('useEnvBaseline', config.envBaseline.enabled);
  setVal('envBaselineStrength', `${config.envBaseline.strength}`);
  setVal('extraCalPings', `${config.envBaseline.pings}`);

  setChecked('vaEnabled', config.virtualArray.enabled);
  setVal('vaHalfWindow', `${config.virtualArray.halfWindow}`);
  setVal('vaWindow', `${config.virtualArray.window}`);
  setVal('vaCoherenceFloor', `${config.virtualArray.coherenceFloor}`);

  setVal('colormapSelect', `${config.colormap}`);
  setChecked('heatmapDbScaleOn', config.heatmapDbScale);
  setVal('heatmapDynamicRangeDb', `${config.heatmapDynamicRangeDb}`);

  const derived = computeDerivedConfig(config.temperature, config.maxRange, config.spacing);
  const computedC = el('computedC');
  if (computedC) computedC.textContent = derived.speedOfSound.toFixed(1);
  const computedListenMs = el('computedListenMs');
  if (computedListenMs) computedListenMs.textContent = derived.listenMs.toFixed(0);
  const computedMinR = el('computedMinR');
  if (computedMinR) computedMinR.textContent = derived.minRange.toFixed(2);
  const computedScanDwell = el('computedScanDwell');
  if (computedScanDwell) computedScanDwell.textContent = derived.scanDwell.toFixed(0);
  const computedMinGolayGap = el('computedMinGolayGap');
  if (computedMinGolayGap) computedMinGolayGap.textContent = derived.minGolayGapMs.toFixed(0);
}

export function readConfigFromDOM(): void {
  const current = store.get().config;
  const calibration = store.get().calibration;
  const mode = selectVal('mode');
  let probe: ProbeConfig;
  if (mode === 'mls') {
    probe = { type: 'mls', params: { order: inputVal('mlsOrder'), chipRate: inputVal('chipRate') } };
  } else if (mode === 'golay') {
    probe = { type: 'golay', params: { order: inputVal('golayOrder'), chipRate: inputVal('golayChipRate'), gapMs: inputVal('golayGapMs') } };
  } else if (mode === 'multiplex') {
    const fusionRaw = selectVal('multiplexFusion');
    const fusion = (fusionRaw === 'snrWeighted' || fusionRaw === 'median' || fusionRaw === 'trimmedMean')
      ? fusionRaw
      : 'snrWeighted';
    const useCalibrated = checkVal('multiplexUseCalibrated')
      && !!calibration?.carrierCalibration
      && calibration.carrierCalibration.activeCarrierHz.length > 0;
    probe = {
      type: 'multiplex',
      params: {
        carrierCount: Math.floor(clamp(inputVal('multiplexCarrierCount', 6), 1, 16)),
        fStart: inputVal('multiplexFStart', 2200),
        fEnd: inputVal('multiplexFEnd', 8800),
        symbolMs: clamp(inputVal('multiplexSymbolMs', 8), 2, 40),
        guardHz: clamp(inputVal('multiplexGuardHz', 180), 20, 2000),
        minSpacingHz: clamp(inputVal('multiplexMinSpacingHz', 220), 20, 3000),
        calibrationCandidates: Math.floor(clamp(inputVal('multiplexCalibrationCandidates', 12), 4, 32)),
        fusion,
        useCalibrated: checkVal('multiplexUseCalibrated'),
        activeCarrierHz: useCalibrated ? calibration?.carrierCalibration?.activeCarrierHz.slice() : undefined,
        carrierWeights: useCalibrated ? calibration?.carrierCalibration?.carrierWeights.slice() : undefined,
        fallbackToChirp: checkVal('multiplexFallbackToChirp'),
      },
    };
  } else {
    probe = { type: 'chirp', params: { f1: inputVal('f1'), f2: inputVal('f2'), durationMs: inputVal('T') } };
  }

  const aggregateModeRaw = selectVal('scanAggregateMode');
  const aggregateMode = aggregateModeRaw === 'median' || aggregateModeRaw === 'trimmedMean' || aggregateModeRaw === 'mean'
    ? aggregateModeRaw
    : current.scanAggregateMode;
  const adaptiveQualityEl = el('adaptiveQualityOn') as HTMLInputElement | null;
  const subtractionBackoffEl = el('subtractionBackoffOn') as HTMLInputElement | null;

  const temperature = inputVal('temperature', 25);
  const maxR = inputVal('maxR', 4.0);
  const spacing = inputVal('spacing', 0.20);
  const derived = computeDerivedConfig(temperature, maxR, spacing);
  const blankingMaxRange = Math.max(0, maxR);
  const blankingStartRange = clamp(
    inputVal('displayBlankingStartRange', current.displayReflectionBlanking.startRange),
    0,
    blankingMaxRange,
  );
  const blankingEndRange = Math.max(
    blankingStartRange,
    clamp(inputVal('displayBlankingEndRange', current.displayReflectionBlanking.endRange), 0, blankingMaxRange),
  );
  const trackTrailMinAlpha = clamp(inputVal('trackTrailMinAlpha', current.trackViz.trailMinAlpha), 0, 1);
  const trackTrailMaxAlpha = Math.max(
    trackTrailMinAlpha,
    clamp(inputVal('trackTrailMaxAlpha', current.trackViz.trailMaxAlpha), 0, 1),
  );

  store.update(s => {
    s.config.probe = probe;
    s.config.steeringAngleDeg = inputVal('angle');
    s.config.spacing = spacing;
    s.config.micArraySpacing = inputVal('micArraySpacing', 0);
    s.config.temperature = temperature;
    s.config.speedOfSound = derived.speedOfSound;
    s.config.gain = inputVal('gain');
    s.config.listenMs = derived.listenMs;
    s.config.minRange = derived.minRange;
    s.config.maxRange = maxR;
    s.config.scanStep = inputVal('scanStep');
    s.config.scanDwell = derived.scanDwell;
    s.config.scanPasses = clamp(inputVal('scanPasses', 1), 1, 8);
    s.config.strengthGate = clamp(inputVal('strengthGate'), 0, 1);
    s.config.confidenceGate = clamp(inputVal('confidenceGate', current.confidenceGate), 0, 1);
    s.config.scanAggregateMode = aggregateMode;
    s.config.scanTrimFraction = clamp(inputVal('scanTrimFraction', current.scanTrimFraction), 0, 0.45);
    s.config.temporalIirAlpha = clamp(inputVal('temporalIirAlpha', current.temporalIirAlpha), 0.01, 1);
    s.config.outlierHistoryN = Math.floor(clamp(inputVal('outlierHistoryN', current.outlierHistoryN), 3, 9));
    s.config.continuityBins = Math.floor(clamp(inputVal('continuityBins', current.continuityBins), 1, 64));
    s.config.qualityAlgo = selectVal('qualityAlgo') as any;
    s.config.adaptiveQuality.enabled = adaptiveQualityEl ? adaptiveQualityEl.checked : current.adaptiveQuality.enabled;
    s.config.adaptiveQuality.hysteresisMs = Math.floor(clamp(inputVal('adaptiveQualityHysteresisMs', current.adaptiveQuality.hysteresisMs), 250, 10000));
    s.config.directionAxis = selectVal('dirAxis') as any;
    s.config.clutterSuppression.enabled = checkVal('scanClutterOn');
    s.config.clutterSuppression.strength = inputVal('scanClutterStrength');
    s.config.displayReflectionBlanking.enabled = checkVal('displayBlankingOn');
    s.config.displayReflectionBlanking.startRange = blankingStartRange;
    s.config.displayReflectionBlanking.endRange = blankingEndRange;
    s.config.displayReflectionBlanking.attenuation = clamp(
      inputVal('displayBlankingAttenuation', current.displayReflectionBlanking.attenuation),
      0,
      1,
    );
    s.config.displayReflectionBlanking.edgeSoftness = clamp(
      inputVal('displayBlankingEdgeSoftness', current.displayReflectionBlanking.edgeSoftness),
      0,
      1.5,
    );
    s.config.envBaseline.enabled = checkVal('useEnvBaseline');
    s.config.envBaseline.strength = inputVal('envBaselineStrength');
    s.config.envBaseline.pings = inputVal('extraCalPings');
    s.config.subtractionBackoff.enabled = subtractionBackoffEl ? subtractionBackoffEl.checked : current.subtractionBackoff.enabled;
    s.config.subtractionBackoff.collapseThreshold = clamp(inputVal('subtractionCollapseThreshold', current.subtractionBackoff.collapseThreshold), 0.01, 1);
    s.config.subtractionBackoff.peakDropThreshold = clamp(inputVal('subtractionPeakDropThreshold', current.subtractionBackoff.peakDropThreshold), 0.01, 1);
    s.config.calibration.repeats = inputVal('calRepeats');
    s.config.calibration.gapMs = inputVal('calRepeatGapMs');
    s.config.calibration.useCalib = checkVal('useCalib');
    s.config.calibration.multiband = checkVal('useMultiband');
    s.config.showTrace = checkVal('showTrace');
    s.config.presetApplyScan = checkVal('presetApplyScan');
    s.config.trackViz.trailMaxPoints = Math.floor(clamp(inputVal('trackTrailMaxPoints', current.trackViz.trailMaxPoints), 4, 80));
    s.config.trackViz.fadeMissCount = Math.floor(clamp(inputVal('trackFadeMissCount', current.trackViz.fadeMissCount), 1, 60));
    s.config.trackViz.trailMinAlpha = trackTrailMinAlpha;
    s.config.trackViz.trailMaxAlpha = trackTrailMaxAlpha;
    s.config.trackViz.minConfidenceFloor = clamp(inputVal('trackMinConfidenceFloor', current.trackViz.minConfidenceFloor), 0, 1);
    s.config.virtualArray.enabled = checkVal('vaEnabled');
    s.config.virtualArray.halfWindow = Math.floor(clamp(inputVal('vaHalfWindow', 3), 0, 12));
    s.config.virtualArray.window = selectVal('vaWindow') === 'gaussian' ? 'gaussian' : 'hann';
    s.config.virtualArray.coherenceFloor = clamp(inputVal('vaCoherenceFloor', 0.25), 0, 1);
    s.config.colormap = (selectVal('colormapSelect') || 'inferno') as ColormapName;
    s.config.heatmapDbScale = checkVal('heatmapDbScaleOn');
    s.config.heatmapDynamicRangeDb = inputVal('heatmapDynamicRangeDb', 40);
  });

  // Update computed-value display labels
  const computedC = el('computedC');
  if (computedC) computedC.textContent = derived.speedOfSound.toFixed(1);
  const computedListenMs = el('computedListenMs');
  if (computedListenMs) computedListenMs.textContent = derived.listenMs.toFixed(0);
  const computedMinR = el('computedMinR');
  if (computedMinR) computedMinR.textContent = derived.minRange.toFixed(2);
  const computedScanDwell = el('computedScanDwell');
  if (computedScanDwell) computedScanDwell.textContent = derived.scanDwell.toFixed(0);
  const computedMinGolayGap = el('computedMinGolayGap');
  if (computedMinGolayGap) computedMinGolayGap.textContent = derived.minGolayGapMs.toFixed(0);
}

export function syncModeUI(): void {
  const m = selectVal('mode');
  const chirpBox = el('chirpBox');
  const mlsBox = el('mlsBox');
  const golayBox = el('golayBox');
  const multiplexBox = el('multiplexBox');
  if (chirpBox) chirpBox.style.display = m === 'chirp' ? '' : 'none';
  if (mlsBox) mlsBox.style.display = m === 'mls' ? '' : 'none';
  if (golayBox) golayBox.style.display = m === 'golay' ? '' : 'none';
  if (multiplexBox) multiplexBox.style.display = m === 'multiplex' ? '' : 'none';
}

export function setButtonStates(audioReady: boolean, scanning: boolean): void {
  const btnPing = el('btnPing') as HTMLButtonElement | null;
  const btnScan = el('btnScan') as HTMLButtonElement | null;
  const btnStop = el('btnStop') as HTMLButtonElement | null;
  const btnCalibrate = el('btnCalibrate') as HTMLButtonElement | null;
  const btnRefreshDevices = el('btnRefreshDevices') as HTMLButtonElement | null;

  if (btnPing) btnPing.disabled = !audioReady || scanning;
  if (btnScan) btnScan.disabled = !audioReady || scanning;
  if (btnStop) btnStop.disabled = !audioReady || !scanning;
  if (btnCalibrate) btnCalibrate.disabled = !audioReady || scanning;
  if (btnRefreshDevices) btnRefreshDevices.disabled = !audioReady;
}
