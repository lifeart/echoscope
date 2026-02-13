import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/network/peer-manager.js', () => ({
  peerManager: {
    onCaptureRequest: vi.fn(),
    getAllRemoteChunks: vi.fn(() => []),
    sendCaptureResponse: vi.fn(),
  },
}));

vi.mock('../../src/network/codec.js', () => ({
  encodeAudioChunk: vi.fn(() => new ArrayBuffer(10)),
}));

vi.mock('../../src/core/store.js', () => ({
  store: {
    get: vi.fn(() => ({
      config: {
        probe: { type: 'chirp', params: { f1: 2000, f2: 9000, durationMs: 7 } },
      },
    })),
  },
}));

vi.mock('../../src/audio/engine.js', () => ({
  getSampleRate: vi.fn(() => 48000),
}));

import { setupRemoteCaptureHandler } from '../../src/network/remote-capture-handler.js';
import { peerManager } from '../../src/network/peer-manager.js';

describe('remote-capture-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('setupRemoteCaptureHandler registers a handler', () => {
    setupRemoteCaptureHandler();
    expect(peerManager.onCaptureRequest).toHaveBeenCalledWith(expect.any(Function));
  });

  it('handler ignores malformed JSON', () => {
    setupRemoteCaptureHandler();
    const handler = vi.mocked(peerManager.onCaptureRequest).mock.calls[0][0];

    // Send garbage data that is not valid JSON
    const garbage = new TextEncoder().encode('not-json{{{');
    handler('peer-1', garbage.buffer);

    expect(peerManager.sendCaptureResponse).not.toHaveBeenCalled();
  });

  it('handler does not send response when no chunks available', () => {
    vi.mocked(peerManager.getAllRemoteChunks).mockReturnValue([]);
    setupRemoteCaptureHandler();
    const handler = vi.mocked(peerManager.onCaptureRequest).mock.calls[0][0];

    const request = JSON.stringify({ pingId: 1, angleDeg: 0, listenMs: 50, probeType: 'chirp' });
    const data = new TextEncoder().encode(request);
    handler('peer-1', data.buffer);

    expect(peerManager.sendCaptureResponse).not.toHaveBeenCalled();
  });

  it('handler sends response when chunks available', () => {
    const chunk = {
      peerId: 'local',
      timestamp: 0,
      sampleRate: 48000,
      channels: [new Float32Array([1, 2, 3])],
      probeConfig: { type: 'chirp' as const, params: { f1: 2000, f2: 9000, durationMs: 7 } },
    };
    vi.mocked(peerManager.getAllRemoteChunks).mockReturnValue([chunk]);

    setupRemoteCaptureHandler();
    const handler = vi.mocked(peerManager.onCaptureRequest).mock.calls[0][0];

    const request = JSON.stringify({ pingId: 42, angleDeg: 0, listenMs: 50, probeType: 'chirp' });
    const data = new TextEncoder().encode(request);
    handler('peer-1', data.buffer);

    expect(peerManager.sendCaptureResponse).toHaveBeenCalledTimes(1);
    expect(peerManager.sendCaptureResponse).toHaveBeenCalledWith('peer-1', expect.any(ArrayBuffer));
  });

  it('response has correct pingId prefix', () => {
    const chunk = {
      peerId: 'local',
      timestamp: 0,
      sampleRate: 48000,
      channels: [new Float32Array([1, 2, 3])],
      probeConfig: { type: 'chirp' as const, params: { f1: 2000, f2: 9000, durationMs: 7 } },
    };
    vi.mocked(peerManager.getAllRemoteChunks).mockReturnValue([chunk]);

    setupRemoteCaptureHandler();
    const handler = vi.mocked(peerManager.onCaptureRequest).mock.calls[0][0];

    const pingId = 12345;
    const request = JSON.stringify({ pingId, angleDeg: 0, listenMs: 50, probeType: 'chirp' });
    const data = new TextEncoder().encode(request);
    handler('peer-1', data.buffer);

    const responseBuffer = vi.mocked(peerManager.sendCaptureResponse).mock.calls[0][1] as ArrayBuffer;
    const view = new DataView(responseBuffer);
    expect(view.getUint32(0)).toBe(pingId);
  });
});
