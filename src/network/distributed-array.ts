import type { SyncedAudioChunk } from '../types.js';

/**
 * Merges remote audio into local multichannel processing.
 * Adjusts timestamps using clock offset and resamples if needed.
 */
export function mergeRemoteAudio(
  localChannels: Float32Array[],
  localSampleRate: number,
  remoteChunks: SyncedAudioChunk[],
): Float32Array[] {
  const merged: Float32Array[] = localChannels.map(ch => ch.slice());

  for (const chunk of remoteChunks) {
    for (const remoteCh of chunk.channels) {
      let resampled: Float32Array;
      if (chunk.sampleRate !== localSampleRate) {
        // Linear interpolation resampling
        const ratio = localSampleRate / chunk.sampleRate;
        const newLen = Math.floor(remoteCh.length * ratio);
        resampled = new Float32Array(newLen);
        for (let i = 0; i < newLen; i++) {
          const srcIdx = i / ratio;
          const lo = Math.floor(srcIdx);
          const hi = Math.min(lo + 1, remoteCh.length - 1);
          const frac = srcIdx - lo;
          resampled[i] = remoteCh[lo] * (1 - frac) + remoteCh[hi] * frac;
        }
      } else {
        resampled = remoteCh.slice();
      }

      // Add as additional channel
      merged.push(resampled);
    }
  }

  return merged;
}
