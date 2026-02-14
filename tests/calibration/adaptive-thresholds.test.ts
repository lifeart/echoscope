import { deriveAdaptiveDetectionThresholds } from '../../src/calibration/engine.js';

function makeProfile(
  length: number,
  noiseFloor: number,
  peakBin: number,
  peakValue: number,
  shoulderValue: number,
): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const ripple = noiseFloor * (0.15 * Math.sin(i * 0.21) + 0.1 * Math.cos(i * 0.13));
    out[i] = Math.max(1e-9, noiseFloor + ripple);
  }

  out[peakBin] = peakValue;
  if (peakBin - 1 >= 0) out[peakBin - 1] = shoulderValue;
  if (peakBin + 1 < length) out[peakBin + 1] = shoulderValue;
  if (peakBin - 2 >= 0) out[peakBin - 2] = shoulderValue * 0.95;
  if (peakBin + 2 < length) out[peakBin + 2] = shoulderValue * 0.95;

  return out;
}

describe('deriveAdaptiveDetectionThresholds', () => {
  const baseInput = {
    minR: 0.3,
    maxR: 4,
    strengthGate: 0.0001,
    confidenceGate: 0.38,
    cfar: { guardCells: 2, trainingCells: 8, pfa: 1e-3, minThreshold: 1e-6 },
  };

  it('relaxes gates for weak but repeatable calibration profiles', () => {
    const profiles = [
      makeProfile(240, 3.1e-5, 160, 9.6e-5, 8.9e-5),
      makeProfile(240, 2.8e-5, 172, 8.8e-5, 8.3e-5),
      makeProfile(240, 3.0e-5, 147, 8.5e-5, 8.0e-5),
      makeProfile(240, 2.9e-5, 136, 9.1e-5, 8.4e-5),
    ];

    const adaptive = deriveAdaptiveDetectionThresholds({
      ...baseInput,
      profiles,
    });

    expect(adaptive).toBeDefined();
    expect(adaptive!.sampleCount).toBe(4);
    expect(adaptive!.strengthGate).toBeLessThan(baseInput.strengthGate);
    expect(adaptive!.strengthGate).toBeLessThan(9.0e-5);
    expect(adaptive!.confidenceGate).toBeLessThan(baseInput.confidenceGate);
    expect(adaptive!.confidenceGate).toBeLessThan(0.11);
    expect(adaptive!.cfarPfa).toBeGreaterThan(baseInput.cfar.pfa);
  });

  it('keeps defaults when profiles are already strong and clean', () => {
    const profiles = [
      makeProfile(240, 3.0e-6, 118, 4.2e-4, 1.1e-4),
      makeProfile(240, 3.4e-6, 122, 4.5e-4, 1.2e-4),
      makeProfile(240, 2.8e-6, 115, 4.0e-4, 1.0e-4),
    ];

    const adaptive = deriveAdaptiveDetectionThresholds({
      ...baseInput,
      profiles,
    });

    expect(adaptive).toBeDefined();
    expect(adaptive!.strengthGate).toBeCloseTo(baseInput.strengthGate, 8);
    expect(adaptive!.confidenceGate).toBeCloseTo(baseInput.confidenceGate, 8);
    expect(adaptive!.cfarPfa).toBeCloseTo(baseInput.cfar.pfa, 8);
  });
});
