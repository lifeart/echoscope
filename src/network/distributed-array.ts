import type { SyncedAudioChunk, ArrayGeometry, PeerNode } from '../types.js';

/**
 * Merges remote audio into local multichannel processing.
 * Adjusts timestamps using clock offset and resamples if needed.
 */
export function mergeRemoteAudio(
  localChannels: Float32Array[],
  localSampleRate: number,
  remoteChunks: SyncedAudioChunk[],
  localTimestamp: number,
): Float32Array[] {
  const localLen = localChannels[0]?.length ?? 0;
  const merged: Float32Array[] = localChannels.map(ch => ch.slice());

  for (const chunk of remoteChunks) {
    // Compute sample offset from timestamp difference
    const timeDelta = chunk.timestamp - localTimestamp;
    const sampleOffset = Math.round(timeDelta * localSampleRate);

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
        resampled = remoteCh;
      }

      // Align to local window and pad/truncate to match localLen
      const aligned = new Float32Array(localLen); // zero-filled by default
      const srcStart = Math.max(0, -sampleOffset);
      const dstStart = Math.max(0, sampleOffset);
      const copyLen = Math.min(resampled.length - srcStart, localLen - dstStart);
      if (copyLen > 0) {
        aligned.set(resampled.subarray(srcStart, srcStart + copyLen), dstStart);
      }

      merged.push(aligned);
    }
  }

  return merged;
}

/**
 * Builds an extended geometry that includes remote mic positions.
 * Local mics first, then remote mics in sorted peer-ID order.
 */
export function buildDistributedGeometry(
  localGeometry: ArrayGeometry,
  peers: Map<string, PeerNode>,
): ArrayGeometry {
  const allMics = [...localGeometry.microphones];

  const sortedPeerIds = [...peers.keys()].sort();
  for (const peerId of sortedPeerIds) {
    const peer = peers.get(peerId)!;
    for (const mic of peer.geometry.microphones) {
      allMics.push({ ...mic });
    }
  }

  return {
    speakers: localGeometry.speakers,
    microphones: allMics,
    spacing: localGeometry.spacing,
    speedOfSound: localGeometry.speedOfSound,
  };
}
