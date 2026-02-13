import { mergeRemoteAudio, buildDistributedGeometry } from '../../src/network/distributed-array.js';
import type { SyncedAudioChunk, ArrayGeometry, PeerNode } from '../../src/types.js';

describe('mergeRemoteAudio', () => {
  it('returns local channels unchanged when no remote chunks', () => {
    const local = [new Float32Array([1, 2, 3])];
    const result = mergeRemoteAudio(local, 48000, [], 0);
    expect(result.length).toBe(1);
    expect(Array.from(result[0])).toEqual([1, 2, 3]);
  });

  it('appends remote channels to local channels', () => {
    const local = [new Float32Array([1, 2, 3])];
    const remote: SyncedAudioChunk[] = [{
      peerId: 'p1',
      timestamp: 0,
      sampleRate: 48000,
      channels: [new Float32Array([4, 5, 6])],
      probeConfig: { type: 'chirp', params: { f1: 2000, f2: 9000, durationMs: 7 } },
    }];
    const result = mergeRemoteAudio(local, 48000, remote, 0);
    expect(result.length).toBe(2);
    // Local channel is sliced (copy)
    expect(Array.from(result[0])).toEqual([1, 2, 3]);
    // Remote channel aligned
    expect(Array.from(result[1])).toEqual([4, 5, 6]);
  });

  it('pads shorter remote channels to match local length', () => {
    const local = [new Float32Array([1, 2, 3, 4, 5])];
    const remote: SyncedAudioChunk[] = [{
      peerId: 'p1',
      timestamp: 0,
      sampleRate: 48000,
      channels: [new Float32Array([10, 20])],
      probeConfig: { type: 'chirp', params: { f1: 2000, f2: 9000, durationMs: 7 } },
    }];
    const result = mergeRemoteAudio(local, 48000, remote, 0);
    expect(result[1].length).toBe(5);
    expect(result[1][0]).toBe(10);
    expect(result[1][1]).toBe(20);
    expect(result[1][2]).toBe(0); // zero-padded
    expect(result[1][3]).toBe(0);
    expect(result[1][4]).toBe(0);
  });

  it('truncates longer remote channels to match local length', () => {
    const local = [new Float32Array([1, 2])];
    const remote: SyncedAudioChunk[] = [{
      peerId: 'p1',
      timestamp: 0,
      sampleRate: 48000,
      channels: [new Float32Array([10, 20, 30, 40, 50])],
      probeConfig: { type: 'chirp', params: { f1: 2000, f2: 9000, durationMs: 7 } },
    }];
    const result = mergeRemoteAudio(local, 48000, remote, 0);
    expect(result[1].length).toBe(2);
    expect(result[1][0]).toBe(10);
    expect(result[1][1]).toBe(20);
  });

  it('applies sample offset from timestamp difference', () => {
    // localSampleRate=4, timeDelta=0.5 → sampleOffset=2
    const local = [new Float32Array([1, 2, 3, 4, 5, 6])];
    const remote: SyncedAudioChunk[] = [{
      peerId: 'p1',
      timestamp: 0.5, // 0.5s after localTimestamp=0
      sampleRate: 4,
      channels: [new Float32Array([10, 20, 30, 40])],
      probeConfig: { type: 'chirp', params: { f1: 2000, f2: 9000, durationMs: 7 } },
    }];
    const result = mergeRemoteAudio(local, 4, remote, 0);
    expect(result[1].length).toBe(6);
    // First 2 samples should be zero (offset), then the remote data
    expect(result[1][0]).toBe(0);
    expect(result[1][1]).toBe(0);
    expect(result[1][2]).toBe(10);
    expect(result[1][3]).toBe(20);
    expect(result[1][4]).toBe(30);
    expect(result[1][5]).toBe(40);
  });

  it('zero-fills gaps for negative sample offset', () => {
    // Remote started before local → negative offset
    const local = [new Float32Array([1, 2, 3, 4])];
    const remote: SyncedAudioChunk[] = [{
      peerId: 'p1',
      timestamp: -0.5, // 0.5s before localTimestamp=0
      sampleRate: 4,
      channels: [new Float32Array([10, 20, 30, 40])],
      probeConfig: { type: 'chirp', params: { f1: 2000, f2: 9000, durationMs: 7 } },
    }];
    const result = mergeRemoteAudio(local, 4, remote, 0);
    expect(result[1].length).toBe(4);
    // Skips first 2 remote samples, takes from index 2
    expect(result[1][0]).toBe(30);
    expect(result[1][1]).toBe(40);
    expect(result[1][2]).toBe(0); // zero-filled
    expect(result[1][3]).toBe(0);
  });

  it('resamples when sample rates differ', () => {
    const local = [new Float32Array([1, 2, 3, 4])];
    const remote: SyncedAudioChunk[] = [{
      peerId: 'p1',
      timestamp: 0,
      sampleRate: 2, // half of local rate=4
      channels: [new Float32Array([10, 20])],
      probeConfig: { type: 'chirp', params: { f1: 2000, f2: 9000, durationMs: 7 } },
    }];
    const result = mergeRemoteAudio(local, 4, remote, 0);
    expect(result[1].length).toBe(4);
    // Resampled from 2 samples at rate 2 to 4 samples at rate 4
    expect(result[1][0]).toBe(10); // original[0]
    expect(result[1][1]).toBe(15); // interpolated
    expect(result[1][2]).toBe(20); // original[1]
    expect(result[1][3]).toBe(20); // extrapolated (hi clamped)
  });

  it('upsamples when remote rate > local rate', () => {
    // Remote sampleRate=8, local=4 → ratio=0.5, newLen = floor(4 * 0.5) = 2
    const local = [new Float32Array([1, 2, 3, 4])];
    const remote: SyncedAudioChunk[] = [{
      peerId: 'p1',
      timestamp: 0,
      sampleRate: 8, // double the local rate
      channels: [new Float32Array([10, 20, 30, 40])],
      probeConfig: { type: 'chirp', params: { f1: 2000, f2: 9000, durationMs: 7 } },
    }];
    const result = mergeRemoteAudio(local, 4, remote, 0);
    expect(result.length).toBe(2);
    expect(result[1].length).toBe(4); // padded/aligned to localLen

    // ratio = 4/8 = 0.5, newLen = floor(4 * 0.5) = 2
    // resampled[0]: srcIdx=0/0.5=0, lo=0, hi=1, frac=0 → 10
    // resampled[1]: srcIdx=1/0.5=2, lo=2, hi=3, frac=0 → 30
    // Then aligned into length-4 array: [10, 30, 0, 0]
    expect(result[1][0]).toBe(10);
    expect(result[1][1]).toBe(30);
    expect(result[1][2]).toBe(0);
    expect(result[1][3]).toBe(0);
  });

  it('merges multiple remote chunks from different peers', () => {
    const local = [new Float32Array([1, 2, 3, 4])];
    const remote: SyncedAudioChunk[] = [
      {
        peerId: 'p1',
        timestamp: 0,
        sampleRate: 4,
        channels: [new Float32Array([10, 20, 30, 40])],
        probeConfig: { type: 'chirp', params: { f1: 2000, f2: 9000, durationMs: 7 } },
      },
      {
        peerId: 'p2',
        timestamp: 0.25, // 1 sample offset at rate 4
        sampleRate: 4,
        channels: [new Float32Array([50, 60, 70, 80])],
        probeConfig: { type: 'chirp', params: { f1: 2000, f2: 9000, durationMs: 7 } },
      },
    ];
    const result = mergeRemoteAudio(local, 4, remote, 0);
    // 1 local + 1 from p1 + 1 from p2 = 3 channels
    expect(result.length).toBe(3);

    // p1: aligned at offset 0
    expect(Array.from(result[1])).toEqual([10, 20, 30, 40]);

    // p2: offset = round(0.25 * 4) = 1 sample
    expect(result[2][0]).toBe(0);   // zero-filled before offset
    expect(result[2][1]).toBe(50);
    expect(result[2][2]).toBe(60);
    expect(result[2][3]).toBe(70);  // 80 is truncated
  });

  it('returns empty remote channels when local channels are length-0', () => {
    const local = [new Float32Array(0)];
    const remote: SyncedAudioChunk[] = [{
      peerId: 'p1',
      timestamp: 0,
      sampleRate: 4,
      channels: [new Float32Array([10, 20, 30])],
      probeConfig: { type: 'chirp', params: { f1: 2000, f2: 9000, durationMs: 7 } },
    }];
    const result = mergeRemoteAudio(local, 4, remote, 0);
    expect(result.length).toBe(2);
    expect(result[0].length).toBe(0);
    // Remote channel is aligned/truncated to localLen=0
    expect(result[1].length).toBe(0);
  });
});

describe('buildDistributedGeometry', () => {
  const localGeometry: ArrayGeometry = {
    speakers: [{ x: -0.1, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }],
    microphones: [{ x: 0, y: 0.01, z: 0 }],
    spacing: 0.2,
    speedOfSound: 343,
  };

  it('returns local geometry when no peers', () => {
    const result = buildDistributedGeometry(localGeometry, new Map());
    expect(result.microphones.length).toBe(1);
    expect(result.speakers).toEqual(localGeometry.speakers);
  });

  it('appends remote mics in sorted peer-ID order', () => {
    const peers = new Map<string, PeerNode>();
    peers.set('peer-2', {
      id: 'peer-2',
      connection: null as unknown as RTCPeerConnection,
      dataChannel: null as unknown as RTCDataChannel,
      clockOffset: 0,
      geometry: {
        speakers: [],
        microphones: [{ x: 1, y: 0, z: 0 }],
        spacing: 0.2,
        speedOfSound: 343,
      },
      lastHeartbeat: 0,
      state: 'ready',
    });
    peers.set('peer-1', {
      id: 'peer-1',
      connection: null as unknown as RTCPeerConnection,
      dataChannel: null as unknown as RTCDataChannel,
      clockOffset: 0,
      geometry: {
        speakers: [],
        microphones: [{ x: 0.5, y: 0, z: 0 }],
        spacing: 0.2,
        speedOfSound: 343,
      },
      lastHeartbeat: 0,
      state: 'ready',
    });

    const result = buildDistributedGeometry(localGeometry, peers);
    expect(result.microphones.length).toBe(3);
    expect(result.microphones[0]).toEqual({ x: 0, y: 0.01, z: 0 }); // local
    expect(result.microphones[1]).toEqual({ x: 0.5, y: 0, z: 0 }); // peer-1 (sorted)
    expect(result.microphones[2]).toEqual({ x: 1, y: 0, z: 0 }); // peer-2 (sorted)
  });

  it('preserves local spacing and speedOfSound (not remote values)', () => {
    const peers = new Map<string, PeerNode>();
    peers.set('peer-1', {
      id: 'peer-1',
      connection: null as unknown as RTCPeerConnection,
      dataChannel: null as unknown as RTCDataChannel,
      clockOffset: 0,
      geometry: {
        speakers: [],
        microphones: [{ x: 1, y: 0, z: 0 }],
        spacing: 0.5,         // different from local (0.2)
        speedOfSound: 1500,   // different from local (343)
      },
      lastHeartbeat: 0,
      state: 'ready',
    });

    const result = buildDistributedGeometry(localGeometry, peers);
    // spacing and speedOfSound should come from localGeometry, not remote
    expect(result.spacing).toBe(0.2);
    expect(result.speedOfSound).toBe(343);
    // speakers should also come from local
    expect(result.speakers).toEqual(localGeometry.speakers);
  });
});
