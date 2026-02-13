import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock peer-manager before importing capture-collector
vi.mock('../../src/network/peer-manager.js', () => ({
  peerManager: {
    getConnectedPeerIds: vi.fn(() => []),
    sendCaptureRequest: vi.fn(),
    onCaptureResponse: vi.fn(),
  },
}));

vi.mock('../../src/network/codec.js', () => ({
  decodeAudioChunk: vi.fn(() => null),
}));

import { broadcastCaptureRequest, waitForRemoteCaptures, setupCaptureResponseHandler } from '../../src/network/capture-collector.js';
import { peerManager } from '../../src/network/peer-manager.js';

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
});
