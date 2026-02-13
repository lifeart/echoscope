import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/network/peer-manager.js', () => ({
  peerManager: {
    onCaptureRequest: vi.fn(),
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

const mockRingBuffer = vi.hoisted(() => ({
  position: 96000,
  readMulti: vi.fn(() => [new Float32Array(4096)]),
}));

vi.mock('../../src/audio/engine.js', () => ({
  getSampleRate: vi.fn(() => 48000),
  getRingBuffer: vi.fn(() => mockRingBuffer),
  computeListenSamples: vi.fn((totalMs: number, _refLen: number, sr: number) =>
    Math.max(2048, Math.floor(sr * (totalMs / 1000))),
  ),
}));

vi.mock('../../src/utils.js', () => ({
  sleep: vi.fn(() => Promise.resolve()),
}));

import { setupRemoteCaptureHandler } from '../../src/network/remote-capture-handler.js';
import { peerManager } from '../../src/network/peer-manager.js';
import { getRingBuffer, computeListenSamples } from '../../src/audio/engine.js';
import { sleep } from '../../src/utils.js';

describe('remote-capture-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRingBuffer.position = 96000;
    mockRingBuffer.readMulti.mockReturnValue([new Float32Array(4096)]);
  });

  it('setupRemoteCaptureHandler registers a handler', () => {
    setupRemoteCaptureHandler();
    expect(peerManager.onCaptureRequest).toHaveBeenCalledWith(expect.any(Function));
  });

  it('handler ignores malformed JSON', async () => {
    setupRemoteCaptureHandler();
    const handler = vi.mocked(peerManager.onCaptureRequest).mock.calls[0][0];

    const garbage = new TextEncoder().encode('not-json{{{');
    handler('peer-1', garbage.buffer);

    // Malformed JSON causes early return before async path
    await new Promise(r => setTimeout(r, 0));
    expect(peerManager.sendCaptureResponse).not.toHaveBeenCalled();
  });

  it('handler does nothing when ring buffer is null', async () => {
    vi.mocked(getRingBuffer).mockReturnValueOnce(null);
    setupRemoteCaptureHandler();
    const handler = vi.mocked(peerManager.onCaptureRequest).mock.calls[0][0];

    const request = JSON.stringify({ pingId: 1, angleDeg: 0, listenMs: 73, probeType: 'chirp' });
    const data = new TextEncoder().encode(request);
    handler('peer-1', data.buffer);

    await new Promise(r => setTimeout(r, 0));
    expect(peerManager.sendCaptureResponse).not.toHaveBeenCalled();
  });

  it('handler waits listenMs + CAPTURE_MARGIN_MS before reading ring buffer', async () => {
    setupRemoteCaptureHandler();
    const handler = vi.mocked(peerManager.onCaptureRequest).mock.calls[0][0];

    const listenMs = 73;
    const request = JSON.stringify({ pingId: 1, angleDeg: 0, listenMs, probeType: 'chirp' });
    const data = new TextEncoder().encode(request);
    handler('peer-1', data.buffer);

    // Wait for the async handler to complete
    await new Promise(r => setTimeout(r, 0));

    expect(sleep).toHaveBeenCalledWith(listenMs + 100); // CAPTURE_MARGIN_MS = 100
  });

  it('handler reads wider capture window from ring buffer', async () => {
    setupRemoteCaptureHandler();
    const handler = vi.mocked(peerManager.onCaptureRequest).mock.calls[0][0];

    const listenMs = 73;
    const request = JSON.stringify({ pingId: 1, angleDeg: 0, listenMs, probeType: 'chirp' });
    const data = new TextEncoder().encode(request);
    handler('peer-1', data.buffer);

    await new Promise(r => setTimeout(r, 0));

    // computeListenSamples should be called with totalMs = listenMs + CAPTURE_MARGIN_MS
    expect(computeListenSamples).toHaveBeenCalledWith(listenMs + 100, 0, 48000);
    // readMulti should be called with position and computed sample count
    expect(mockRingBuffer.readMulti).toHaveBeenCalledWith(
      96000,
      expect.any(Number),
    );
  });

  it('handler sends response with correct pingId prefix', async () => {
    setupRemoteCaptureHandler();
    const handler = vi.mocked(peerManager.onCaptureRequest).mock.calls[0][0];

    const pingId = 12345;
    const request = JSON.stringify({ pingId, angleDeg: 0, listenMs: 73, probeType: 'chirp' });
    const data = new TextEncoder().encode(request);
    handler('peer-1', data.buffer);

    await new Promise(r => setTimeout(r, 0));

    expect(peerManager.sendCaptureResponse).toHaveBeenCalledTimes(1);
    expect(peerManager.sendCaptureResponse).toHaveBeenCalledWith('peer-1', expect.any(ArrayBuffer));

    const responseBuffer = vi.mocked(peerManager.sendCaptureResponse).mock.calls[0][1] as ArrayBuffer;
    const view = new DataView(responseBuffer);
    expect(view.getUint32(0)).toBe(pingId);
  });
});
