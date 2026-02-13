import { delayAndSum } from '../../src/spatial/rx-beamformer.js';
import type { ArrayGeometry } from '../../src/types.js';

function makeGeometry(spacing: number, c: number): ArrayGeometry {
  return {
    speakers: [
      { x: -spacing / 2, y: 0, z: 0 },
      { x: spacing / 2, y: 0, z: 0 },
    ],
    microphones: [
      { x: -spacing / 2, y: 0, z: 0 },
      { x: spacing / 2, y: 0, z: 0 },
    ],
    spacing,
    speedOfSound: c,
  };
}

function synthesizePlaneWave(
  angleDeg: number,
  geometry: ArrayGeometry,
  sampleRate: number,
  freq: number,
  nSamples: number,
): Float32Array[] {
  const theta = angleDeg * Math.PI / 180;
  const c = geometry.speedOfSound;
  const mics = geometry.microphones;
  const centerX = mics.reduce((s, m) => s + m.x, 0) / mics.length;

  return mics.map(mic => {
    const dx = mic.x - centerX;
    // Negative sign: source at +θ means right mic (dx>0) receives FIRST (earlier)
    const delaySec = -(dx * Math.sin(theta)) / c;
    const delaySamples = delaySec * sampleRate;
    const ch = new Float32Array(nSamples);
    for (let i = 0; i < nSamples; i++) {
      ch[i] = Math.sin(2 * Math.PI * freq * (i - delaySamples) / sampleRate);
    }
    return ch;
  });
}

describe('delayAndSum', () => {
  const sr = 48000;
  const spacing = 0.245;
  const c = 343;
  const geo = makeGeometry(spacing, c);

  it('returns single channel unchanged for nChannels < 2', () => {
    const ch = new Float32Array([1, 2, 3]);
    const result = delayAndSum([ch], 0, geo, sr);
    expect(result.length).toBe(3);
    expect(result[0]).toBe(1);
  });

  it('boosts signal when steered to correct angle', () => {
    const angleDeg = 20;
    const freq = 1000;
    const nSamples = 2048;
    const channels = synthesizePlaneWave(angleDeg, geo, sr, freq, nSamples);

    // Steer to correct angle — should have high power
    const aligned = delayAndSum(channels, angleDeg, geo, sr);
    // Steer to wrong angle — should have lower power
    const misaligned = delayAndSum(channels, -angleDeg, geo, sr);

    // Compute RMS power
    const rms = (arr: Float32Array) => {
      let sum = 0;
      for (let i = 0; i < arr.length; i++) sum += arr[i] * arr[i];
      return Math.sqrt(sum / arr.length);
    };

    expect(rms(aligned)).toBeGreaterThan(rms(misaligned));
  });

  it('0° steering on 0° source gives near-unity output', () => {
    const nSamples = 1024;
    const freq = 2000;
    const channels = synthesizePlaneWave(0, geo, sr, freq, nSamples);
    const result = delayAndSum(channels, 0, geo, sr);

    // At 0° both channels are identical, DAS = average = same amplitude
    const peakInput = Math.max(...Array.from(channels[0]).map(Math.abs));
    const peakOutput = Math.max(...Array.from(result).map(Math.abs));
    expect(peakOutput).toBeCloseTo(peakInput, 1);
  });

  it('returns empty array for empty input', () => {
    const result = delayAndSum([new Float32Array(0), new Float32Array(0)], 0, geo, sr);
    expect(result.length).toBe(0);
  });

  it('applies per-channel delay compensation offsets', () => {
    const angleDeg = 25;
    const freq = 1400;
    const nSamples = 2048;
    const extraLagSamples = 3;
    const channels = synthesizePlaneWave(angleDeg, geo, sr, freq, nSamples);

    const laggedChannels = [
      channels[0],
      new Float32Array(nSamples),
    ];
    for (let i = extraLagSamples; i < nSamples; i++) {
      laggedChannels[1][i] = channels[1][i - extraLagSamples];
    }

    const uncompensated = delayAndSum(laggedChannels, angleDeg, geo, sr);
    const compensated = delayAndSum(laggedChannels, angleDeg, geo, sr, [0, -extraLagSamples / sr]);

    const rms = (arr: Float32Array) => {
      let sum = 0;
      for (let i = 0; i < arr.length; i++) sum += arr[i] * arr[i];
      return Math.sqrt(sum / arr.length);
    };

    expect(rms(compensated)).toBeGreaterThan(rms(uncompensated));
  });
});
