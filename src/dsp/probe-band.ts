/**
 * Derive the active frequency band of the current probe signal.
 *
 * Used to bandpass-filter the microphone signal before cross-correlation,
 * so that out-of-band noise is removed.  This dramatically improves the
 * signal-to-noise ratio of the normalized correlation (estimateCorrelationEvidence)
 * because out-of-band noise no longer inflates the sliding-window energy denominator.
 *
 * A small margin (default 200 Hz) is added on each side to accommodate
 * Doppler shifts and filter roll-off.
 */

import type { ProbeConfig } from '../types.js';
import { designBandpass, applyBandpass, type BandpassCoeffs } from './bandpass.js';

export interface ProbeBand {
  /** Lower edge of the probe frequency band (Hz) */
  fLow: number;
  /** Upper edge of the probe frequency band (Hz) */
  fHigh: number;
}

const MARGIN_HZ = 200;

/**
 * Return the frequency band occupied by a probe configuration.
 */
export function getProbeFreqBand(probe: ProbeConfig): ProbeBand {
  switch (probe.type) {
    case 'chirp': {
      const lo = Math.min(probe.params.f1, probe.params.f2);
      const hi = Math.max(probe.params.f1, probe.params.f2);
      return { fLow: lo, fHigh: hi };
    }
    case 'mls': {
      // MLS is a binary ±1 sequence clocked at chipRate.
      // Its spectral content is roughly 0 – chipRate/2.
      return { fLow: 0, fHigh: probe.params.chipRate / 2 };
    }
    case 'golay': {
      return { fLow: 0, fHigh: probe.params.chipRate / 2 };
    }
    case 'multiplex': {
      return { fLow: probe.params.fStart, fHigh: probe.params.fEnd };
    }
  }
}

// ---- Cached bandpass filter ----
let cachedCoeffs: BandpassCoeffs | null = null;
let cachedKey = '';

function filterKey(fLow: number, fHigh: number, sampleRate: number): string {
  return `${fLow.toFixed(1)}_${fHigh.toFixed(1)}_${sampleRate}`;
}

/**
 * Design (or reuse cached) bandpass filter for the probe band.
 * Returns null if the band covers nearly the full Nyquist range
 * (filtering would be pointless).
 */
function getOrDesignFilter(
  band: ProbeBand,
  sampleRate: number,
): BandpassCoeffs | null {
  const nyquist = sampleRate / 2;
  const fLow = Math.max(20, band.fLow - MARGIN_HZ);
  const fHigh = Math.min(nyquist - 20, band.fHigh + MARGIN_HZ);

  // If the filter would pass ≥95% of the spectrum, skip filtering
  if (fLow <= 40 && fHigh >= nyquist * 0.95) return null;
  if (fHigh <= fLow + 100) return null;

  const key = filterKey(fLow, fHigh, sampleRate);
  if (cachedCoeffs && cachedKey === key) return cachedCoeffs;

  // 129 taps ≈ 2.7ms at 48 kHz — good balance between selectivity and latency
  cachedCoeffs = designBandpass(fLow, fHigh, sampleRate, 129);
  cachedKey = key;
  return cachedCoeffs;
}

/**
 * Bandpass-filter a microphone signal to the probe frequency band.
 * Returns the filtered signal (same length).
 * If no filtering is needed (probe occupies full spectrum), returns
 * the input unmodified (no copy).
 */
export function bandpassToProbe(
  micSignal: Float32Array,
  probe: ProbeConfig,
  sampleRate: number,
): Float32Array {
  const band = getProbeFreqBand(probe);
  const coeffs = getOrDesignFilter(band, sampleRate);
  if (!coeffs) return micSignal;
  return applyBandpass(micSignal, coeffs);
}

/** Reset the cached filter (e.g. when probe config changes). */
export function resetProbeBandCache(): void {
  cachedCoeffs = null;
  cachedKey = '';
}
