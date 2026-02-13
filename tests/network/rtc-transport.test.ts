import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock RTCPeerConnection and RTCDataChannel
class MockDataChannel {
  binaryType = 'arraybuffer';
  readyState = 'open';
  onmessage: ((ev: any) => void) | null = null;
  send = vi.fn();
  close = vi.fn();
}

class MockPeerConnection {
  connectionState = 'new';
  iceGatheringState = 'complete';
  localDescription: any = { type: 'offer', sdp: 'mock-sdp' };
  onconnectionstatechange: (() => void) | null = null;
  onicegatheringstatechange: (() => void) | null = null;
  ondatachannel: ((ev: any) => void) | null = null;

  createDataChannel = vi.fn(() => new MockDataChannel());
  createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'mock-sdp' }));
  createAnswer = vi.fn(async () => ({ type: 'answer', sdp: 'mock-sdp' }));
  setLocalDescription = vi.fn(async () => {});
  setRemoteDescription = vi.fn(async function (this: MockPeerConnection) {
    // Simulate datachannel event after setting remote description
    setTimeout(() => {
      if (this.ondatachannel) {
        this.ondatachannel({ channel: new MockDataChannel() });
      }
    }, 0);
  });
  close = vi.fn();
}

// @ts-expect-error - mock global
globalThis.RTCPeerConnection = MockPeerConnection;

import { RTCTransport } from '../../src/network/rtc-transport.js';

describe('RTCTransport', () => {
  let transport: RTCTransport;

  beforeEach(() => {
    transport = new RTCTransport();
  });

  it('send returns false when no peer exists', () => {
    const result = transport.send('unknown-peer', new ArrayBuffer(8));
    expect(result).toBe(false);
  });

  it('send returns false when datachannel is not open', async () => {
    await transport.createOffer('peer-1');
    // Get the peer and set its datachannel readyState to 'closed'
    const peers = transport.getPeers();
    const peer = peers.get('peer-1')!;
    (peer.dataChannel as any).readyState = 'closed';

    const result = transport.send('peer-1', new ArrayBuffer(8));
    expect(result).toBe(false);
  });

  it('send returns true when datachannel is open', async () => {
    await transport.createOffer('peer-1');

    const result = transport.send('peer-1', new ArrayBuffer(8));
    expect(result).toBe(true);
  });

  it('broadcast sends to all peers with open datachannels', async () => {
    await transport.createOffer('peer-1');
    await transport.createOffer('peer-2');

    const data = new ArrayBuffer(8);
    transport.broadcast(data);

    const peers = transport.getPeers();
    expect((peers.get('peer-1')!.dataChannel.send as any)).toHaveBeenCalledWith(data);
    expect((peers.get('peer-2')!.dataChannel.send as any)).toHaveBeenCalledWith(data);
  });

  it('disconnect closes datachannel and connection', async () => {
    await transport.createOffer('peer-1');
    const peers = transport.getPeers();
    const dc = peers.get('peer-1')!.dataChannel;
    const conn = peers.get('peer-1')!.connection;

    transport.disconnect('peer-1');

    expect(dc.close).toHaveBeenCalled();
    expect(conn.close).toHaveBeenCalled();
  });

  it('disconnect removes peer from map', async () => {
    await transport.createOffer('peer-1');
    transport.disconnect('peer-1');

    const peers = transport.getPeers();
    expect(peers.size).toBe(0);
  });

  it('acceptAnswer throws for unknown peerId', async () => {
    await expect(
      transport.acceptAnswer('unknown', { type: 'answer', sdp: 'mock' }),
    ).rejects.toThrow('Unknown peer: unknown');
  });

  it('getPeers returns a copy', async () => {
    await transport.createOffer('peer-1');
    const a = transport.getPeers();
    const b = transport.getPeers();
    expect(a).not.toBe(b);
  });

  it('updatePeer updates clockOffset', async () => {
    await transport.createOffer('peer-1');
    transport.updatePeer('peer-1', { clockOffset: 42 });

    const peers = transport.getPeers();
    expect(peers.get('peer-1')!.clockOffset).toBe(42);
  });

  it('updatePeer updates geometry', async () => {
    await transport.createOffer('peer-1');
    const newGeometry = {
      speakers: [{ x: 0, y: 0, z: 0 }],
      microphones: [{ x: 1, y: 1, z: 0 }],
      spacing: 0.5,
      speedOfSound: 340,
    };
    transport.updatePeer('peer-1', { geometry: newGeometry });

    const peers = transport.getPeers();
    expect(peers.get('peer-1')!.geometry).toEqual(newGeometry);
  });

  it('onMessage callback receives peerId and data', async () => {
    const handler = vi.fn();
    transport.onMessage(handler);

    await transport.createOffer('peer-1');

    const peers = transport.getPeers();
    const dc = peers.get('peer-1')!.dataChannel as unknown as MockDataChannel;
    const payload = new ArrayBuffer(4);
    dc.onmessage!({ data: payload });

    expect(handler).toHaveBeenCalledWith('peer-1', payload);
  });

  it('onPeerState callback fires on connectionstatechange', async () => {
    const handler = vi.fn();
    transport.onPeerState(handler);

    await transport.createOffer('peer-1');

    const peers = transport.getPeers();
    const conn = peers.get('peer-1')!.connection as unknown as MockPeerConnection;
    conn.connectionState = 'connected';
    conn.onconnectionstatechange!();

    expect(handler).toHaveBeenCalledWith('peer-1', 'connected');
  });
});
