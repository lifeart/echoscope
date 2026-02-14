import { store } from '../../src/core/store.js';

let cancelAfterFirstPing = false;
let pingCalls = 0;

vi.mock('../../src/scan/ping-cycle.js', () => ({
  resetClutter: () => {},
  doPingDetailed: async () => {
    throw new Error('Legacy TX-steering scan should not be used in this test');
  },
}));

vi.mock('../../src/spatial/steering.js', () => ({
  pingAndCaptureOneSide: async () => {
    pingCalls++;
    if (cancelAfterFirstPing && pingCalls === 1) {
      store.set('scanning', false);
    }
    const micWin = new Float32Array(256);
    micWin[32] = 1;
    return {
      micWin,
      micChannels: [micWin],
      which: 'L' as const,
      delay: 0.012,
    };
  },
}));

import { doScan } from '../../src/scan/scan-engine.js';

describe('scan-engine cancellation behavior', () => {
  beforeEach(() => {
    store.reset();
    pingCalls = 0;
    cancelAfterFirstPing = false;

    store.update(s => {
      s.audio.context = {} as AudioContext;
      s.status = 'ready';
      s.lastDirection.angle = 25;
      s.lastDirection.strength = 0.8;
      s.lastTarget.angle = 25;
      s.lastTarget.range = 1.4;
      s.lastTarget.strength = 0.8;

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

  it('does not overwrite direction/target when scan is cancelled mid-run', async () => {
    cancelAfterFirstPing = true;

    await doScan();

    const state = store.get();
    expect(state.scanning).toBe(false);
    expect(state.status).toBe('ready');
    expect(state.lastDirection.angle).toBe(25);
    expect(state.lastDirection.strength).toBe(0.8);
    expect(state.lastTarget.angle).toBe(25);
    expect(state.lastTarget.range).toBe(1.4);
    expect(state.lastTarget.strength).toBe(0.8);
  });
});
