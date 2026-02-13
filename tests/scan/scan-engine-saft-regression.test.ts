import { createHeatmap } from '../../src/scan/heatmap-data.js';
import { applySaftHeatmapIfEnabled } from '../../src/scan/scan-engine.js';
import type { AppConfig, RawAngleFrame } from '../../src/types.js';

function makeBaseConfig(overrides?: Partial<AppConfig['virtualArray']>): Pick<AppConfig, 'virtualArray' | 'spacing' | 'speedOfSound'> {
  return {
    spacing: 0.2,
    speedOfSound: 343,
    virtualArray: {
      enabled: false,
      halfWindow: 3,
      window: 'hann',
      phaseCenterHz: 4000,
      coherenceFloor: 0.25,
      maxTauShiftSamples: 192,
      ...overrides,
    },
  };
}

function makeLowCoherenceFrames(angles: number[], corrLen = 128): RawAngleFrame[] {
  return angles.map((angleDeg, row) => {
    const corrReal = new Float32Array(corrLen);
    const corrImag = new Float32Array(corrLen);

    for (let n = 0; n < corrLen; n++) {
      const phase = 2 * Math.PI * (0.19 * row + 0.31 * n);
      const amp = 0.01 + 0.003 * ((n % 5) / 5);
      corrReal[n] = amp * Math.cos(phase);
      corrImag[n] = amp * Math.sin(phase);
    }

    return {
      angleDeg,
      sampleRate: 48000,
      tau0: 0,
      corrReal,
      corrImag,
      centerFreqHz: 6000,
      quality: 0.2,
    };
  });
}

describe('scan-engine SAFT regressions', () => {
  it('SAFT disabled leaves heatmap unchanged (exact regression guard)', () => {
    const angles = [-30, -15, 0, 15, 30];
    const bins = 16;
    const heatmap = createHeatmap(angles, bins);

    for (let i = 0; i < heatmap.data.length; i++) {
      heatmap.data[i] = 0.1 + i * 1e-4;
      heatmap.display[i] = 0.05 + i * 1e-4;
    }
    for (let r = 0; r < angles.length; r++) {
      heatmap.bestBin[r] = r;
      heatmap.bestVal[r] = 0.2 + r * 0.01;
    }

    const dataBefore = Float32Array.from(heatmap.data);
    const displayBefore = Float32Array.from(heatmap.display);
    const bestBinBefore = Int16Array.from(heatmap.bestBin);
    const bestValBefore = Float32Array.from(heatmap.bestVal);

    const applied = applySaftHeatmapIfEnabled(
      heatmap,
      makeLowCoherenceFrames(angles),
      angles,
      0.3,
      4.0,
      makeBaseConfig({ enabled: false }),
    );

    expect(applied).toBe(false);
    expect(Array.from(heatmap.data)).toEqual(Array.from(dataBefore));
    expect(Array.from(heatmap.display)).toEqual(Array.from(displayBefore));
    expect(Array.from(heatmap.bestBin)).toEqual(Array.from(bestBinBefore));
    expect(Array.from(heatmap.bestVal)).toEqual(Array.from(bestValBefore));
  });

  it('SAFT enabled on low coherence data stays finite and bounded', () => {
    const angles = [-45, -30, -15, 0, 15, 30, 45];
    const bins = 64;
    const heatmap = createHeatmap(angles, bins);

    const applied = applySaftHeatmapIfEnabled(
      heatmap,
      makeLowCoherenceFrames(angles, 196),
      angles,
      0.005,
      0.06,
      makeBaseConfig({ enabled: true, halfWindow: 2, coherenceFloor: 0.3, maxTauShiftSamples: 96 }),
    );

    expect(applied).toBe(true);

    for (let i = 0; i < heatmap.data.length; i++) {
      const v = heatmap.data[i];
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }

    for (let r = 0; r < angles.length; r++) {
      const b = heatmap.bestBin[r];
      const v = heatmap.bestVal[r];
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(b).toBeGreaterThanOrEqual(-1);
      expect(b).toBeLessThan(bins);
    }
  });

  it('SAFT enabled with insufficient rows is skipped safely', () => {
    const angles = [-10, 0, 10];
    const heatmap = createHeatmap(angles, 24);
    const dataBefore = Float32Array.from(heatmap.data);

    const applied = applySaftHeatmapIfEnabled(
      heatmap,
      makeLowCoherenceFrames(angles, 80),
      angles,
      0.1,
      1.0,
      makeBaseConfig({ enabled: true, halfWindow: 2 }),
    );

    expect(applied).toBe(false);
    expect(Array.from(heatmap.data)).toEqual(Array.from(dataBefore));
  });
});
