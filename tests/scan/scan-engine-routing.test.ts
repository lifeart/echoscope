import { store } from '../../src/core/store.js';

let doPingDetailedCalls = 0;
let pingAndCaptureOneSideCalls = 0;

vi.mock('../../src/scan/ping-cycle.js', () => ({
  resetClutter: () => {},
  doPingDetailed: async (angleDeg: number) => {
    doPingDetailedCalls++;
    if (doPingDetailedCalls === 1) {
      store.set('scanning', false);
    }

    const bins = new Float32Array([0.02, 0.9, 0.05, 0.01]);
    return {
      profile: {
        bins,
        minRange: 0.3,
        maxRange: 4.0,
        binCount: bins.length,
        bestBin: 1,
        bestRange: 1.2,
        bestStrength: 0.9,
      },
      rawFrame: {
        angleDeg,
        sampleRate: 48000,
        tau0: 0,
        corrReal: new Float32Array([0, 1, 0]),
        corrImag: new Float32Array([0, 0, 0]),
        centerFreqHz: 4000,
        quality: 0.9,
      },
    };
  },
}));

vi.mock('../../src/spatial/steering.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/spatial/steering.js')>();
  return {
    ...actual,
    pingAndCaptureOneSide: async () => {
      pingAndCaptureOneSideCalls++;
      const micWin = new Float32Array(1024);
      micWin[32] = 1;
      return {
        micWin,
        micChannels: [micWin],
        which: 'L' as const,
        delay: 0.012,
      };
    },
  };
});

import { doScan } from '../../src/scan/scan-engine.js';

describe('scan-engine routing by probe type', () => {
  beforeEach(() => {
    store.reset();
    doPingDetailedCalls = 0;
    pingAndCaptureOneSideCalls = 0;

    store.update(s => {
      s.audio.context = {} as AudioContext;
      s.audio.actualSampleRate = 48000;
      s.status = 'ready';
      s.config.scanStep = 120;
      s.config.scanDwell = 0;
      s.config.scanPasses = 1;
      s.config.minRange = 0.3;
      s.config.maxRange = 4.0;
      s.config.heatBins = 4;
      s.config.strengthGate = 0.05;
      s.config.confidenceGate = 0;
      s.config.temporalIirAlpha = 0.18;
      s.config.virtualArray.enabled = false;
    });
  });

  it('uses L/R path for mls scan', async () => {
    store.update(s => {
      s.config.probe = { type: 'mls', params: { order: 10, chipRate: 5000 } };
    });

    await doScan();

    expect(doPingDetailedCalls).toBe(0);
    expect(pingAndCaptureOneSideCalls).toBeGreaterThan(0);
  });

  it('uses L/R path for golay scan', async () => {
    store.update(s => {
      s.config.probe = { type: 'golay', params: { order: 10, chipRate: 5000, gapMs: 12 } };
    });

    await doScan();

    expect(doPingDetailedCalls).toBe(0);
    expect(pingAndCaptureOneSideCalls).toBeGreaterThan(0);
  });
});
