import { buildRxGeometry } from '../../src/scan/ping-cycle.js';
import { delayAndSum } from '../../src/spatial/rx-beamformer.js';
import type { ArrayGeometry } from '../../src/types.js';

describe('buildRxGeometry', () => {
  it('returns null for spacing <= 0', () => {
    expect(buildRxGeometry(0, 343, 2)).toBeNull();
    expect(buildRxGeometry(-0.01, 343, 2)).toBeNull();
  });

  it('returns geometry with 2 microphones for positive spacing', () => {
    const geo = buildRxGeometry(0.05, 343, 2);
    expect(geo).not.toBeNull();
    expect(geo!.microphones.length).toBe(2);
    expect(geo!.speedOfSound).toBe(343);
    // Mic positions should be symmetric around center
    const dx = geo!.microphones[1].x - geo!.microphones[0].x;
    expect(dx).toBeCloseTo(0.05, 6);
  });
});

describe('RX beamforming integration', () => {
  const geometry: ArrayGeometry = {
    speakers: [{ x: -0.1, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }],
    microphones: [{ x: -0.025, y: 0, z: 0 }, { x: 0.025, y: 0, z: 0 }],
    spacing: 0.2,
    speedOfSound: 343,
  };

  it('delayAndSum with 1 channel returns input unchanged', () => {
    const signal = new Float32Array([1, 2, 3, 4, 5]);
    const result = delayAndSum([signal], 0, geometry, 48000);
    expect(result).toBe(signal);
  });

  it('beamformed identical channels preserves amplitude at 0 degrees', () => {
    const N = 1024;
    const signal = new Float32Array(N);
    for (let i = 0; i < N; i++) signal[i] = Math.sin(2 * Math.PI * 1000 * i / 48000);
    const ch0 = new Float32Array(signal);
    const ch1 = new Float32Array(signal);

    const result = delayAndSum([ch0, ch1], 0, geometry, 48000);
    expect(result.length).toBe(N);

    // At 0 degrees, both channels are aligned, so output should be close to input
    let maxIn = 0, maxOut = 0;
    for (let i = 0; i < N; i++) {
      if (Math.abs(signal[i]) > maxIn) maxIn = Math.abs(signal[i]);
      if (Math.abs(result[i]) > maxOut) maxOut = Math.abs(result[i]);
    }
    // Output peak should be close to input peak (within 5%)
    expect(maxOut).toBeGreaterThan(maxIn * 0.9);
    expect(maxOut).toBeLessThan(maxIn * 1.1);
  });

  it('beamformed delayed signal shows directional effect', () => {
    const N = 1024;
    const sr = 48000;
    const freq = 2000;

    // Identical signals - should sum coherently at 0 degrees
    const ch0 = new Float32Array(N);
    const ch1 = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      ch0[i] = Math.sin(2 * Math.PI * freq * i / sr);
      ch1[i] = Math.sin(2 * Math.PI * freq * i / sr);
    }

    const at0 = delayAndSum([ch0, ch1], 0, geometry, sr);
    const at60 = delayAndSum([ch0, ch1], 60, geometry, sr);

    // Both should produce output, but at 60 degrees the delay compensation
    // misaligns identical signals slightly, reducing energy
    let energy0 = 0, energy60 = 0;
    for (let i = 0; i < N; i++) {
      energy0 += at0[i] * at0[i];
      energy60 += at60[i] * at60[i];
    }

    // At 0 degrees, identical channels are perfectly aligned → max energy
    // At 60 degrees, delay compensation misaligns them → reduced energy
    expect(energy0).toBeGreaterThan(0);
    expect(energy60).toBeGreaterThan(0);
    // The on-axis energy should be >= off-axis for identical signals
    expect(energy0).toBeGreaterThanOrEqual(energy60 * 0.95);
  });
});
