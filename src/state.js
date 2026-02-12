export const state = {
  // Audio engine
  ac: null,
  sr: 48000,
  micStream: null,
  micSource: null,
  micTapNode: null,
  useWorklet: false,

  // Ring buffer
  ring: null,
  ringSize: 0,
  ringWrite: 0,

  // Scan control
  scanning: false,

  // Heatmap storage
  heat: null,
  heatDisplay: null,
  scanClutter: null,
  heatAngles: [],
  heatBins: 240,

  // Best-target trace storage
  bestBin: null,
  bestVal: null,

  // Last profile draw state (for resize redraw)
  lastProfileCorr: null,
  lastProfileTau0: 0,
  lastProfileC: 343,
  lastProfileMinR: 0.3,
  lastProfileMaxR: 4.0,

  // Last detected target state (for geometry view)
  lastTargetAngle: NaN,
  lastTargetRange: NaN,
  lastTargetStrength: 0,

  // Direction tracking
  lastDirectionAngle: NaN,
  lastDirectionStrength: 0,

  // Preset mic position
  presetMicPosition: { x: null, y: null },

  // Quality algorithm performance tracking
  qualityPerf: {
    ewmaMs: 7,
    lastResolved: "balanced",
    lastSwitchAt: 0
  },

  // Geometry wizard state
  geomWizard: {
    active: false,
    touched: false,
    dragging: null,
    handles: {
      spL: { u: -0.1, f: 0 },
      spR: { u: 0.1, f: 0 },
      mic: { u: 0, f: 0.12 }
    }
  },

  // Calibration state
  calib: {
    valid: false,
    quality: 0,
    monoLikely: false,

    d: NaN, c: NaN,
    tauMeasL: NaN, tauMeasR: NaN,
    peakL: NaN, peakR: NaN,
    rL: NaN, rR: NaN,
    x: NaN, y: NaN, geomErr: NaN,
    tauSysCommon: NaN, tauSysL: NaN, tauSysR: NaN,
    tauMadL: NaN, tauMadR: NaN,
    envBaseline: null,
    envBaselinePings: 0,

    sanity: {
      have: false,
      earlyMs: 60,
      curveL: null,
      curveR: null,
      peakIdxL: 0,
      peakIdxR: 0,
      tauL: NaN,
      tauR: NaN,
      peakL: NaN,
      peakR: NaN,
      dt: NaN,
      dp: NaN,
      expectDiff: false,
      monoByTime: false,
      monoByPeak: false
    }
  }
};
