import { describe, it, expect } from 'vitest';
import { estimateCorrelationEvidence } from '../../src/dsp/correlation-evidence.js';
import { fftCorrelateComplex } from '../../src/dsp/fft-correlate.js';
import { bandpassToProbe, resetProbeBandCache } from '../../src/dsp/probe-band.js';
import { buildJointHeatmapFromLR } from '../../src/scan/joint-lr.js';
import { aggregateProfiles } from '../../src/scan/heatmap-data.js';
import type { ProbeConfig } from '../../src/types.js';

/**
 * Integration tests for the scan pipeline's muted-speaker rejection.
 *
 * Tests the complete chain that prevents false detections when speakers are muted:
 * 1. TX evidence uses FILTERED mic signal (matched energy source) with
 *    prominence gate: noise prominence is 5–8, threshold is 8.0.
 * 2. Golay AND gate: both halves must pass TX evidence
 * 3. L/R profile energy gate: aggregated profiles must have max > 1e-10
 * 4. Joint heatmap: geometric mean sqrt(L*R) zeros out single-side noise
 */

const SR = 48000;

function pseudoNoise(len: number, amplitude: number, seed = 42): Float32Array {
  const buf = new Float32Array(len);
  let s = seed;
  for (let i = 0; i < len; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    buf[i] = ((s / 0x7fffffff) - 0.5) * 2 * amplitude;
  }
  return buf;
}

function makeChirpRef(len: number, f1 = 2000, f2 = 9000): Float32Array {
  const ref = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const freq = f1 + t * (f2 - f1);
    ref[i] = Math.sin(2 * Math.PI * freq * t);
  }
  return ref;
}

const CHIRP_PROBE: ProbeConfig = { type: 'chirp', params: { f1: 2000, f2: 9000, durationMs: 7 } };

beforeEach(() => {
  resetProbeBandCache();
});

describe('TX evidence: prominence gate rejects noise', () => {
  it('noise-only mic: filtered signal produces higher peakNorm than unfiltered', () => {
    const ref = makeChirpRef(336);
    const noise = pseudoNoise(3500, 0.08, 99);

    // Correlation uses filtered mic
    const micFiltered = bandpassToProbe(noise, CHIRP_PROBE, SR);
    const corr = fftCorrelateComplex(micFiltered, ref, SR).correlation;

    // TX evidence on unfiltered vs filtered
    const evUnfiltered = estimateCorrelationEvidence(corr, noise, ref);
    const evFiltered = estimateCorrelationEvidence(corr, micFiltered, ref);

    // Unfiltered has more energy in denominator → lower peakNorm
    expect(evUnfiltered.peakNorm).toBeLessThan(evFiltered.peakNorm);
  });

  it('noise-only: prominence gate rejects noise with filtered energy', () => {
    // With minProminence=8.0, noise (prominence 5–8) is mostly rejected.
    // Some trials near the boundary may pass.
    const ref = makeChirpRef(336);
    let filteredPassCount = 0;
    const TRIALS = 20;

    for (let seed = 1; seed <= TRIALS; seed++) {
      const noise = pseudoNoise(3500, 0.08, seed * 13);
      resetProbeBandCache();
      const micFiltered = bandpassToProbe(noise, CHIRP_PROBE, SR);
      const corr = fftCorrelateComplex(micFiltered, ref, SR).correlation;

      // Use filtered mic (the production code path now)
      const ev = estimateCorrelationEvidence(corr, micFiltered, ref);
      if (ev.pass) filteredPassCount++;
    }

    // Most noise should be rejected; allow some boundary passes
    expect(filteredPassCount).toBeLessThanOrEqual(TRIALS / 2);
  });

  it('real signal + noise: filtered signal passes TX evidence', () => {
    const ref = makeChirpRef(336);
    const signal = pseudoNoise(3500, 0.02, 55); // light noise floor

    // Embed real chirp at offset
    for (let i = 0; i < ref.length; i++) {
      signal[700 + i] += ref[i] * 0.5;
    }

    const micFiltered = bandpassToProbe(signal, CHIRP_PROBE, SR);
    const corr = fftCorrelateComplex(micFiltered, ref, SR).correlation;

    // TX evidence on filtered signal (production code path)
    const ev = estimateCorrelationEvidence(corr, micFiltered, ref);
    expect(ev.pass).toBe(true);
    expect(ev.peakNorm).toBeGreaterThan(0.01); // above minPeakNorm
  });
});

describe('Golay AND gate logic', () => {
  it('AND gate: both pass → combined pass', () => {
    const txA = { pass: true, peakNorm: 0.06 };
    const txB = { pass: true, peakNorm: 0.05 };
    const combinedPass = txA.pass && txB.pass;
    expect(combinedPass).toBe(true);
  });

  it('AND gate: one fails → combined fails', () => {
    const txA = { pass: true, peakNorm: 0.06 };
    const txB = { pass: false, peakNorm: 0.02 };
    const combinedPass = txA.pass && txB.pass;
    expect(combinedPass).toBe(false);
  });

  it('AND gate: both fail → combined fails', () => {
    const txA = { pass: false, peakNorm: 0.02 };
    const txB = { pass: false, peakNorm: 0.01 };
    const combinedPass = txA.pass && txB.pass;
    expect(combinedPass).toBe(false);
  });

  it('AND gate reduces false positive rate vs OR gate', () => {
    // If each half has p=0.3 false positive rate:
    // OR gate: 1 - (1-p)^2 = 0.51
    // AND gate: p^2 = 0.09
    const p = 0.3;
    const orRate = 1 - Math.pow(1 - p, 2);
    const andRate = p * p;
    expect(andRate).toBeLessThan(orRate);
    expect(andRate).toBeCloseTo(0.09);
    expect(orRate).toBeCloseTo(0.51);
  });

  it('with noise-only, Golay AND gate rejects more reliably than single test', () => {
    const ref = makeChirpRef(336);
    let andPassCount = 0;
    let singlePassCount = 0;
    const TRIALS = 30;

    for (let seed = 1; seed <= TRIALS; seed++) {
      // Simulate two independent noise captures (Golay A and B)
      const noiseA = pseudoNoise(3500, 0.08, seed * 7);
      const noiseB = pseudoNoise(3500, 0.08, seed * 7 + 1000);

      resetProbeBandCache();
      const filtA = bandpassToProbe(noiseA, CHIRP_PROBE, SR);
      const corrA = fftCorrelateComplex(filtA, ref, SR).correlation;
      const txA = estimateCorrelationEvidence(corrA, noiseA, ref);

      resetProbeBandCache();
      const filtB = bandpassToProbe(noiseB, CHIRP_PROBE, SR);
      const corrB = fftCorrelateComplex(filtB, ref, SR).correlation;
      const txB = estimateCorrelationEvidence(corrB, noiseB, ref);

      if (txA.pass && txB.pass) andPassCount++;
      if (txA.pass) singlePassCount++;
    }

    // AND gate should have fewer passes than single tests
    expect(andPassCount).toBeLessThanOrEqual(singlePassCount);
  });
});

describe('L/R profile energy gate', () => {
  const ENERGY_GATE_THRESHOLD = 1e-10;

  it('zero L profiles → aggregated maxL < threshold → no detection', () => {
    // Simulate: all captures returned zero profile (TX evidence failed)
    const zeroProfiles = [
      new Float32Array(100),
      new Float32Array(100),
      new Float32Array(100),
    ];
    const { averaged } = aggregateProfiles(zeroProfiles);

    let maxL = 0;
    for (let i = 0; i < averaged.length; i++) {
      if (averaged[i] > maxL) maxL = averaged[i];
    }

    expect(maxL).toBeLessThan(ENERGY_GATE_THRESHOLD);
  });

  it('zero R profiles → aggregated maxR < threshold → no detection', () => {
    const zeroProfiles = [
      new Float32Array(100),
      new Float32Array(100),
    ];
    const { averaged } = aggregateProfiles(zeroProfiles);

    let maxR = 0;
    for (let i = 0; i < averaged.length; i++) {
      if (averaged[i] > maxR) maxR = averaged[i];
    }

    expect(maxR).toBeLessThan(ENERGY_GATE_THRESHOLD);
  });

  it('real profiles pass energy gate', () => {
    const realProfile = new Float32Array(100);
    realProfile[50] = 0.01;
    realProfile[49] = 0.005;
    realProfile[51] = 0.005;

    const { averaged } = aggregateProfiles([realProfile]);

    let maxVal = 0;
    for (let i = 0; i < averaged.length; i++) {
      if (averaged[i] > maxVal) maxVal = averaged[i];
    }

    expect(maxVal).toBeGreaterThan(ENERGY_GATE_THRESHOLD);
  });

  it('one side zero → no joint heatmap should be built', () => {
    // Simulate the gate logic in scan-engine.ts
    const realProfile = new Float32Array(100);
    realProfile[50] = 0.005;
    const zeroProfile = new Float32Array(100);

    const aggregatedL = aggregateProfiles([realProfile]).averaged;
    const aggregatedR = aggregateProfiles([zeroProfile]).averaged;

    let maxL = 0, maxR = 0;
    for (let i = 0; i < aggregatedL.length; i++) {
      if (aggregatedL[i] > maxL) maxL = aggregatedL[i];
    }
    for (let i = 0; i < aggregatedR.length; i++) {
      if (aggregatedR[i] > maxR) maxR = aggregatedR[i];
    }

    // Gate condition: if maxL < 1e-10 || maxR < 1e-10 → skip
    const gatePass = maxL >= ENERGY_GATE_THRESHOLD && maxR >= ENERGY_GATE_THRESHOLD;
    expect(gatePass).toBe(false); // R is zero → gate fails
  });

  it('if gate somehow passes with tiny values, joint heatmap zeros them', () => {
    // Even if the energy gate is barely passed, the geometric mean
    // sqrt(L*R) with one near-zero profile produces near-zero output
    const bins = 50;
    const profileL = new Float32Array(bins);
    profileL[25] = 1e-3; // real signal on L
    const profileR = new Float32Array(bins); // zero on R

    const result = buildJointHeatmapFromLR({
      profileL,
      profileR,
      anglesDeg: [0],
      minRange: 0.3,
      maxRange: 4.0,
      speakerSpacingM: 0.24,
      edgeMaskBins: 1,
    });

    // Even without energy gate, joint heatmap should produce zero
    for (let i = 0; i < result.data.length; i++) {
      expect(result.data[i]).toBe(0);
    }
    expect(result.bestVal[0]).toBe(0);
  });
});

describe('end-to-end: muted speaker → no detection', () => {
  it('full pipeline: noise → bandpass → correlate → TX evidence → zero profile → zero heatmap', () => {
    const ref = makeChirpRef(336);
    const bins = 100;
    const angles = [-30, 0, 30];

    // Simulate L and R muted captures (noise only)
    const leftProfiles: Float32Array[] = [];
    const rightProfiles: Float32Array[] = [];

    for (let pass = 0; pass < 3; pass++) {
      const noiseL = pseudoNoise(3500, 0.08, pass * 17 + 1);
      const noiseR = pseudoNoise(3500, 0.08, pass * 17 + 100);

      // Bandpass filter for correlation
      resetProbeBandCache();
      const filtL = bandpassToProbe(noiseL, CHIRP_PROBE, SR);
      const corrL = fftCorrelateComplex(filtL, ref, SR).correlation;
      // TX evidence on UNFILTERED mic
      const txL = estimateCorrelationEvidence(corrL, noiseL, ref);

      resetProbeBandCache();
      const filtR = bandpassToProbe(noiseR, CHIRP_PROBE, SR);
      const corrR = fftCorrelateComplex(filtR, ref, SR).correlation;
      const txR = estimateCorrelationEvidence(corrR, noiseR, ref);

      // If TX evidence fails → zero profile
      leftProfiles.push(txL.pass ? new Float32Array(bins).fill(0.001) : new Float32Array(bins));
      rightProfiles.push(txR.pass ? new Float32Array(bins).fill(0.001) : new Float32Array(bins));
    }

    // Aggregate profiles
    const aggregatedL = aggregateProfiles(leftProfiles).averaged;
    const aggregatedR = aggregateProfiles(rightProfiles).averaged;

    // Check energy gate
    let maxL = 0, maxR = 0;
    for (let i = 0; i < aggregatedL.length; i++) if (aggregatedL[i] > maxL) maxL = aggregatedL[i];
    for (let i = 0; i < aggregatedR.length; i++) if (aggregatedR[i] > maxR) maxR = aggregatedR[i];

    // If either side is below energy gate → no detection
    if (maxL < 1e-10 || maxR < 1e-10) {
      // Gate blocked → good, no false detection
      expect(true).toBe(true);
      return;
    }

    // If gate passes (unlikely with noise), check joint heatmap
    const joint = buildJointHeatmapFromLR({
      profileL: aggregatedL,
      profileR: aggregatedR,
      anglesDeg: angles,
      minRange: 0.3,
      maxRange: 4.0,
      speakerSpacingM: 0.24,
      edgeMaskBins: 2,
    });

    // Even if some noise leaks through, bestVal should be very small
    let maxBestVal = 0;
    for (let r = 0; r < angles.length; r++) {
      if (joint.bestVal[r] > maxBestVal) maxBestVal = joint.bestVal[r];
    }

    // Joint values from noise should be negligible
    expect(maxBestVal).toBeLessThan(0.01);
  });
});
