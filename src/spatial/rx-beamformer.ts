import type { ArrayGeometry } from '../types.js';
import { getPolyphaseTable, polyphaseInterpolate } from './polyphase-table.js';

/**
 * Delay-and-sum beamformer for multichannel RX data.
 * Aligns channels by computed delays and sums them.
 */
export function delayAndSum(
  channels: Float32Array[],
  steeringAngleDeg: number,
  geometry: ArrayGeometry,
  sampleRate: number,
): Float32Array {
  const nChannels = channels.length;
  const nSamples = channels[0]?.length ?? 0;
  if (nChannels < 2 || nSamples === 0) {
    return channels[0] ?? new Float32Array(0);
  }
  const nMics = geometry.microphones.length;
  if (nChannels !== nMics) {
    console.warn(`[beamformer] channel count (${nChannels}) !== mic count (${nMics}); using first channel`);
    return channels[0];
  }

  const theta = steeringAngleDeg * Math.PI / 180;
  const c = geometry.speedOfSound;
  const output = new Float32Array(nSamples);

  // Compute per-mic delays relative to the array center
  const mics = geometry.microphones;
  const centerX = mics.reduce((sum, m) => sum + m.x, 0) / mics.length;
  const delays: number[] = [];

  for (let ch = 0; ch < nChannels; ch++) {
    const mic = mics[ch] ?? mics[0];
    const dx = mic.x - centerX;
    // Delay in samples for plane wave at angle theta
    const delaySec = (dx * Math.sin(theta)) / c;
    delays.push(delaySec * sampleRate);
  }

  // Normalize delays so minimum is 0
  const minDelay = Math.min(...delays);
  for (let ch = 0; ch < nChannels; ch++) {
    delays[ch] -= minDelay;
  }

  // Apply delays and sum (polyphase interpolation for higher quality)
  const table = getPolyphaseTable();
  for (let ch = 0; ch < nChannels; ch++) {
    const temp = new Float32Array(nSamples);
    polyphaseInterpolate(channels[ch], delays[ch], table, temp);
    for (let i = 0; i < nSamples; i++) output[i] += temp[i];
  }

  // Normalize by channel count
  const inv = 1 / nChannels;
  for (let i = 0; i < nSamples; i++) output[i] *= inv;

  return output;
}
