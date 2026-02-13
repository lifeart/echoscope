import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock peer-manager before importing capture-collector
vi.mock('../../src/network/peer-manager.js', () => ({
  peerManager: {
    getConnectedPeerIds: vi.fn(() => []),
    sendCaptureRequest: vi.fn(),
    onCaptureResponse: vi.fn(),
    getPeerClockOffset: vi.fn(() => 0),
  },
}));

vi.mock('../../src/network/codec.js', () => ({
  decodeAudioChunk: vi.fn(() => null),
}));

import { broadcastCaptureRequest, waitForRemoteCaptures, setupCaptureResponseHandler } from '../../src/network/capture-collector.js';
import { peerManager } from '../../src/network/peer-manager.js';
import { decodeAudioChunk } from '../../src/network/codec.js';

/** Build a capture response buffer: [4-byte pingId][audio payload] */
function buildResponseBuffer(pingId: number, audioPayload: ArrayBuffer): ArrayBuffer {
  const buf = new ArrayBuffer(4 + audioPayload.byteLength);
  new DataView(buf).setUint32(0, pingId);
  new Uint8Array(buf).set(new Uint8Array(audioPayload), 4);
  return buf;
}

describe('capture-collector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array immediately when no peers connected', async () => {
    vi.mocked(peerManager.getConnectedPeerIds).mockReturnValue([]);
    const result = await waitForRemoteCaptures(1, 100);
    expect(result).toEqual([]);
  });

  it('broadcastCaptureRequest does nothing when no peers', () => {
    vi.mocked(peerManager.getConnectedPeerIds).mockReturnValue([]);
    broadcastCaptureRequest(1, 0, 50, 'chirp');
    expect(peerManager.sendCaptureRequest).not.toHaveBeenCalled();
  });

  it('broadcastCaptureRequest sends when peers connected', () => {
    vi.mocked(peerManager.getConnectedPeerIds).mockReturnValue(['peer-1']);
    broadcastCaptureRequest(1, 45, 50, 'chirp');
    expect(peerManager.sendCaptureRequest).toHaveBeenCalledTimes(1);
  });

  it('waitForRemoteCaptures resolves with empty on timeout', async () => {
    vi.mocked(peerManager.getConnectedPeerIds).mockReturnValue(['peer-1']);
    const result = await waitForRemoteCaptures(999, 10);
    expect(result).toEqual([]);
  });

  it('setupCaptureResponseHandler registers callback on peerManager', () => {
    setupCaptureResponseHandler();
    expect(peerManager.onCaptureResponse).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Response handler: clock offset sign and data flow
  // ---------------------------------------------------------------------------

  it('response handler subtracts clock offset from timestamp', async () => {
    const pingId = 5001;
    const remoteTimestamp = 10.0;
    const clockOffset = 0.050; // remote is 50ms ahead

    vi.mocked(peerManager.getConnectedPeerIds).mockReturnValue(['peer-1']);
    vi.mocked(peerManager.getPeerClockOffset).mockReturnValue(clockOffset);
    vi.mocked(decodeAudioChunk).mockReturnValueOnce({
      timestamp: remoteTimestamp,
      sampleRate: 48000,
      channels: [new Float32Array([1, 2, 3])],
      probeType: 'chirp',
    });

    setupCaptureResponseHandler();
    const handler = vi.mocked(peerManager.onCaptureResponse).mock.calls[0][0];

    // Start waiting for captures, then deliver the response
    const promise = waitForRemoteCaptures(pingId, 1000);
    const responseData = buildResponseBuffer(pingId, new ArrayBuffer(8));
    handler('peer-1', responseData);

    const responses = await promise;
    expect(responses).toHaveLength(1);
    // Critical: timestamp = remoteTimestamp - clockOffset, NOT + clockOffset
    expect(responses[0].timestamp).toBe(remoteTimestamp - clockOffset); // 10.0 - 0.050 = 9.950
  });

  it('response handler passes through peerId, sampleRate, and channels', async () => {
    const pingId = 5002;
    const mockChannels = [new Float32Array([0.5, -0.5])];

    vi.mocked(peerManager.getConnectedPeerIds).mockReturnValue(['peer-42']);
    vi.mocked(peerManager.getPeerClockOffset).mockReturnValue(0);
    vi.mocked(decodeAudioChunk).mockReturnValueOnce({
      timestamp: 1.0,
      sampleRate: 44100,
      channels: mockChannels,
      probeType: 'mls',
    });

    setupCaptureResponseHandler();
    const handler = vi.mocked(peerManager.onCaptureResponse).mock.calls[0][0];

    const promise = waitForRemoteCaptures(pingId, 1000);
    handler('peer-42', buildResponseBuffer(pingId, new ArrayBuffer(8)));

    const responses = await promise;
    expect(responses).toHaveLength(1);
    expect(responses[0].peerId).toBe('peer-42');
    expect(responses[0].sampleRate).toBe(44100);
    expect(responses[0].channels).toBe(mockChannels);
  });

  it('response handler resolves when all expected peers respond', async () => {
    const pingId = 5003;

    vi.mocked(peerManager.getConnectedPeerIds).mockReturnValue(['peer-1', 'peer-2']);
    vi.mocked(peerManager.getPeerClockOffset).mockReturnValue(0);

    setupCaptureResponseHandler();
    const handler = vi.mocked(peerManager.onCaptureResponse).mock.calls[0][0];

    const promise = waitForRemoteCaptures(pingId, 5000);

    // First response — should not resolve yet
    vi.mocked(decodeAudioChunk).mockReturnValueOnce({
      timestamp: 1.0, sampleRate: 48000,
      channels: [new Float32Array([1])], probeType: 'chirp',
    });
    handler('peer-1', buildResponseBuffer(pingId, new ArrayBuffer(8)));

    // Second response — should resolve
    vi.mocked(decodeAudioChunk).mockReturnValueOnce({
      timestamp: 2.0, sampleRate: 48000,
      channels: [new Float32Array([2])], probeType: 'chirp',
    });
    handler('peer-2', buildResponseBuffer(pingId, new ArrayBuffer(8)));

    const responses = await promise;
    expect(responses).toHaveLength(2);
    expect(responses[0].peerId).toBe('peer-1');
    expect(responses[1].peerId).toBe('peer-2');
  });

  it('response handler ignores data shorter than 4 bytes', async () => {
    vi.mocked(peerManager.getConnectedPeerIds).mockReturnValue(['peer-1']);

    setupCaptureResponseHandler();
    const handler = vi.mocked(peerManager.onCaptureResponse).mock.calls[0][0];

    const promise = waitForRemoteCaptures(5004, 20);

    // Send truncated data (< 4 bytes)
    handler('peer-1', new ArrayBuffer(3));

    // Should timeout with empty (the short data was ignored)
    const responses = await promise;
    expect(responses).toEqual([]);
  });

  it('response handler ignores when decode returns null', async () => {
    vi.mocked(peerManager.getConnectedPeerIds).mockReturnValue(['peer-1']);
    vi.mocked(decodeAudioChunk).mockReturnValueOnce(null);

    setupCaptureResponseHandler();
    const handler = vi.mocked(peerManager.onCaptureResponse).mock.calls[0][0];

    const promise = waitForRemoteCaptures(5005, 20);
    handler('peer-1', buildResponseBuffer(5005, new ArrayBuffer(8)));

    const responses = await promise;
    expect(responses).toEqual([]);
  });
});
