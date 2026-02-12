import type { PeerNode, ArrayGeometry } from '../types.js';

export type MessageHandler = (data: ArrayBuffer) => void;

export class RTCTransport {
  private peers = new Map<string, PeerNode>();
  private onMessageCallback: MessageHandler | null = null;

  onMessage(callback: MessageHandler): void {
    this.onMessageCallback = callback;
  }

  async createOffer(peerId: string): Promise<RTCSessionDescriptionInit> {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    const dc = pc.createDataChannel('audio', { ordered: false, maxRetransmits: 0 });
    dc.binaryType = 'arraybuffer';
    dc.onmessage = (ev) => this.onMessageCallback?.(ev.data);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Wait for ICE gathering to complete
    await new Promise<void>((resolve) => {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') resolve();
      };
    });

    const defaultGeometry: ArrayGeometry = {
      speakers: [{ x: -0.1, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }],
      microphones: [{ x: 0, y: 0.01, z: 0 }],
      spacing: 0.2,
      speedOfSound: 343,
    };

    this.peers.set(peerId, {
      id: peerId,
      connection: pc,
      dataChannel: dc,
      clockOffset: 0,
      geometry: defaultGeometry,
      lastHeartbeat: Date.now(),
    });

    return pc.localDescription!;
  }

  async acceptOffer(
    peerId: string,
    offer: RTCSessionDescriptionInit,
  ): Promise<RTCSessionDescriptionInit> {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    let dataChannel: RTCDataChannel | null = null;
    pc.ondatachannel = (ev) => {
      dataChannel = ev.channel;
      dataChannel.binaryType = 'arraybuffer';
      dataChannel.onmessage = (msgEv) => this.onMessageCallback?.(msgEv.data);
    };

    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await new Promise<void>((resolve) => {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') resolve();
      };
    });

    const defaultGeometry: ArrayGeometry = {
      speakers: [{ x: -0.1, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }],
      microphones: [{ x: 0, y: 0.01, z: 0 }],
      spacing: 0.2,
      speedOfSound: 343,
    };

    this.peers.set(peerId, {
      id: peerId,
      connection: pc,
      dataChannel: dataChannel!,
      clockOffset: 0,
      geometry: defaultGeometry,
      lastHeartbeat: Date.now(),
    });

    return pc.localDescription!;
  }

  async acceptAnswer(peerId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) throw new Error(`Unknown peer: ${peerId}`);
    await peer.connection.setRemoteDescription(answer);
  }

  send(peerId: string, data: ArrayBuffer): void {
    const peer = this.peers.get(peerId);
    if (!peer?.dataChannel || peer.dataChannel.readyState !== 'open') return;
    peer.dataChannel.send(data);
  }

  broadcast(data: ArrayBuffer): void {
    for (const peer of this.peers.values()) {
      if (peer.dataChannel?.readyState === 'open') {
        peer.dataChannel.send(data);
      }
    }
  }

  disconnect(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.dataChannel?.close();
      peer.connection.close();
      this.peers.delete(peerId);
    }
  }

  disconnectAll(): void {
    for (const peerId of this.peers.keys()) {
      this.disconnect(peerId);
    }
  }

  getPeers(): Map<string, PeerNode> {
    return new Map(this.peers);
  }
}
