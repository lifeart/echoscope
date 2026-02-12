import { computeCalibQuality } from '../../src/calibration/quality-score.js';

describe('computeCalibQuality', () => {
  it('returns high quality for good stats', () => {
    const q = computeCalibQuality({
      tauMadL: 0.00005,
      tauMadR: 0.00005,
      peakL: 0.8,
      peakR: 0.7,
      geomErr: 0.001,
      monoLikely: false,
    });
    expect(q).toBeGreaterThan(0.7);
  });

  it('returns low quality for bad stats', () => {
    const q = computeCalibQuality({
      tauMadL: 0.002,
      tauMadR: 0.002,
      peakL: 0.05,
      peakR: 0.05,
      geomErr: 0.1,
      monoLikely: true,
    });
    expect(q).toBeLessThan(0.2);
  });

  it('penalizes mono output', () => {
    const stereo = computeCalibQuality({
      tauMadL: 0.0001, tauMadR: 0.0001,
      peakL: 0.5, peakR: 0.5,
      geomErr: 0.01, monoLikely: false,
    });
    const mono = computeCalibQuality({
      tauMadL: 0.0001, tauMadR: 0.0001,
      peakL: 0.5, peakR: 0.5,
      geomErr: 0.01, monoLikely: true,
    });
    expect(mono).toBeLessThan(stereo);
  });
});
