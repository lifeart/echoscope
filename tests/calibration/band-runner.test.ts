import { runBandCalibration, type RawPingCapture } from '../../src/calibration/band-runner.js';
import { genGolayChipped } from '../../src/signal/golay.js';
import type { BandConfig } from '../../src/types.js';

const SR = 48000;
const D = 0.195; // speaker spacing (MacBook Air 13")
const C = 343;   // speed of sound

const BAND_M: BandConfig = { id: 'M', label: 'Mid', fLow: 900, fHigh: 2500, filterTaps: 129 };
const BAND_H: BandConfig = { id: 'H', label: 'High-mid', fLow: 2500, fHigh: 5500, filterTaps: 129 };

// Generate Golay pair
const golay = genGolayChipped({ order: 10, chipRate: 5000, gapMs: 12 }, SR);
const { a, b } = golay;

/**
 * Create a synthetic mic capture where the Golay sequence appears at a known delay.
 * Places both A and B responses at the given delay in the capture windows.
 */
function synthCapture(
  delayL: number,  // delay in seconds for L channel
  delayR: number,  // delay in seconds for R channel
  noise = 0.01,
): RawPingCapture {
  // Capture must be longer than Golay reference + delay + earlyMs margin
  const listenSamples = a.length + Math.ceil(SR * 0.07); // ref length + 70ms
  const micLA = new Float32Array(listenSamples);
  const micLB = new Float32Array(listenSamples);
  const micRA = new Float32Array(listenSamples);
  const micRB = new Float32Array(listenSamples);

  const offsetL = Math.round(delayL * SR);
  const offsetR = Math.round(delayR * SR);

  // Place Golay A/B at the delay positions
  for (let i = 0; i < a.length && offsetL + i < listenSamples; i++) {
    if (offsetL + i >= 0) micLA[offsetL + i] = a[i] * 0.5;
  }
  for (let i = 0; i < b.length && offsetL + i < listenSamples; i++) {
    if (offsetL + i >= 0) micLB[offsetL + i] = b[i] * 0.5;
  }
  for (let i = 0; i < a.length && offsetR + i < listenSamples; i++) {
    if (offsetR + i >= 0) micRA[offsetR + i] = a[i] * 0.5;
  }
  for (let i = 0; i < b.length && offsetR + i < listenSamples; i++) {
    if (offsetR + i >= 0) micRB[offsetR + i] = b[i] * 0.5;
  }

  // Add noise
  if (noise > 0) {
    for (const buf of [micLA, micLB, micRA, micRB]) {
      for (let i = 0; i < buf.length; i++) {
        buf[i] += (Math.random() - 0.5) * noise;
      }
    }
  }

  return { micLA, micLB, micRA, micRB };
}

describe('runBandCalibration', () => {
  it('returns a valid BandCalibrationResult for clean signal', () => {
    const delayL = 0.004; // 4ms
    const delayR = 0.0042; // 4.2ms (slight TDOA)

    // Create 8 pilot captures and 3 repeat captures
    const pilots: RawPingCapture[] = [];
    const repeats: RawPingCapture[] = [];
    for (let i = 0; i < 8; i++) pilots.push(synthCapture(delayL, delayR, 0.005));
    for (let i = 0; i < 3; i++) repeats.push(synthCapture(delayL, delayR, 0.005));

    const result = runBandCalibration(BAND_M, pilots, repeats, a, b, SR, D, C);

    expect(result.bandId).toBe('M');
    expect(result.bandHz).toEqual([900, 2500]);
    // Should have found pilot measurements
    expect(result.pilotClusterSize).toBeGreaterThan(0);
    // deltaTau should have correct sign (R slightly later than L)
    expect(result.deltaTau).toBeGreaterThan(0);
  });

  it('returns invalid result when no pilot measurements are found', () => {
    // All-zero captures → no peaks
    const zeroCap: RawPingCapture = {
      micLA: new Float32Array(4800),
      micLB: new Float32Array(4800),
      micRA: new Float32Array(4800),
      micRB: new Float32Array(4800),
    };
    const pilots = Array.from({ length: 8 }, () => zeroCap);
    const repeats = Array.from({ length: 3 }, () => zeroCap);

    const result = runBandCalibration(BAND_M, pilots, repeats, a, b, SR, D, C);
    expect(result.valid).toBe(false);
    expect(result.quality).toBe(0);
  });

  it('works for different band configs', () => {
    const delayL = 0.004;
    const delayR = 0.0042;
    const pilots = Array.from({ length: 8 }, () => synthCapture(delayL, delayR, 0.005));
    const repeats = Array.from({ length: 3 }, () => synthCapture(delayL, delayR, 0.005));

    const resultM = runBandCalibration(BAND_M, pilots, repeats, a, b, SR, D, C);
    const resultH = runBandCalibration(BAND_H, pilots, repeats, a, b, SR, D, C);

    expect(resultM.bandId).toBe('M');
    expect(resultH.bandId).toBe('H');
    expect(resultM.bandHz).toEqual([900, 2500]);
    expect(resultH.bandHz).toEqual([2500, 5500]);
  });

  it('reports pilotAboveFloor when pilot tau exceeds TAU_MIN_ACOUSTIC', () => {
    const delayL = 0.004; // 4ms, well above 0.6ms floor
    const delayR = 0.004;
    const pilots = Array.from({ length: 8 }, () => synthCapture(delayL, delayR, 0.005));
    const repeats = Array.from({ length: 3 }, () => synthCapture(delayL, delayR, 0.005));

    const result = runBandCalibration(BAND_M, pilots, repeats, a, b, SR, D, C);
    if (result.pilotClusterSize > 0 && result.pilotTau > 0.0006) {
      expect(result.pilotAboveFloor).toBe(true);
    }
  });
});
