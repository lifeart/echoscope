import type { PeerNode, ArrayGeometry } from '../types.js';

export type MessageHandler = (peerId: string, data: ArrayBuffer) => void;
export type PeerStateHandler = (peerId: string, state: RTCPeerConnectionState) => void;

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const DEFAULT_GEOMETRY: ArrayGeometry = {
  speakers: [{ x: -0.1, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }],
  microphones: [{ x: 0, y: 0.01, z: 0 }],
  spacing: 0.2,
  speedOfSound: 343,
};

export class RTCTransport {
  private peers = new Map<string, PeerNode>();
  private onMessageCallback: MessageHandler | null = null;
  private onPeerStateCallback: PeerStateHandler | null = null;

  onMessage(callback: MessageHandler): void {
    this.onMessageCallback = callback;
  }

  onPeerState(callback: PeerStateHandler): void {
    this.onPeerStateCallback = callback;
  }

  async createOffer(peerId: string): Promise<RTCSessionDescriptionInit> {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.attachConnectionStateHandler(pc, peerId);

    const dc = pc.createDataChannel('audio', { ordered: false, maxRetransmits: 0 });
    dc.binaryType = 'arraybuffer';
    dc.onmessage = (ev) => this.onMessageCallback?.(peerId, ev.data);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.waitForIceGathering(pc);

    const desc = pc.localDescription;
    if (!desc) throw new Error('ICE gathering produced no local description');

    this.peers.set(peerId, {
      id: peerId,
      connection: pc,
      dataChannel: dc,
      clockOffset: 0,
      geometry: { ...DEFAULT_GEOMETRY },
      lastHeartbeat: Date.now(),
      state: 'connecting',
    });

    return desc;
  }

  async acceptOffer(
    peerId: string,
    offer: RTCSessionDescriptionInit,
  ): Promise<RTCSessionDescriptionInit> {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.attachConnectionStateHandler(pc, peerId);

    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await this.waitForIceGathering(pc);

    // Register peer immediately so the answer can be returned to the caller
    // (e.g. for QR display). The data channel arrives later once the
    // initiator applies the answer and connectivity is established.
    // No timeout — cleanup is handled by connectionState → 'failed'/'closed'
    // via attachConnectionStateHandler, which is important for QR pairing
    // where the remote side may take 30+ seconds to scan the answer.
    const peerNode: PeerNode = {
      id: peerId,
      connection: pc,
      dataChannel: null as unknown as RTCDataChannel,
      clockOffset: 0,
      geometry: { ...DEFAULT_GEOMETRY },
      lastHeartbeat: Date.now(),
      state: 'connecting',
    };
    const desc = pc.localDescription;
    if (!desc) throw new Error('ICE gathering produced no local description');

    this.peers.set(peerId, peerNode);

    // Patch in the data channel once it arrives (background, non-blocking).
    pc.ondatachannel = (ev) => {
      const channel = ev.channel;
      channel.binaryType = 'arraybuffer';
      channel.onmessage = (msgEv) => this.onMessageCallback?.(peerId, msgEv.data);
      peerNode.dataChannel = channel;
    };

    return desc;
  }

  async acceptAnswer(peerId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) throw new Error(`Unknown peer: ${peerId}`);
    await peer.connection.setRemoteDescription(answer);
  }

  send(peerId: string, data: ArrayBuffer): boolean {
    const peer = this.peers.get(peerId);
    if (!peer?.dataChannel || peer.dataChannel.readyState !== 'open') return false;
    peer.dataChannel.send(data);
    return true;
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
      peer.connection.onconnectionstatechange = null;
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

  updatePeer(peerId: string, update: Partial<Pick<PeerNode, 'clockOffset' | 'geometry' | 'lastHeartbeat' | 'state'>>): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    if (update.clockOffset !== undefined) peer.clockOffset = update.clockOffset;
    if (update.geometry !== undefined) peer.geometry = update.geometry;
    if (update.lastHeartbeat !== undefined) peer.lastHeartbeat = update.lastHeartbeat;
    if (update.state !== undefined) peer.state = update.state;
  }

  private waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
    return new Promise<void>((resolve) => {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      const timer = setTimeout(() => resolve(), 10000);
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timer);
          resolve();
        }
      };
    });
  }

  private attachConnectionStateHandler(pc: RTCPeerConnection, peerId: string): void {
    pc.onconnectionstatechange = () => {
      this.onPeerStateCallback?.(peerId, pc.connectionState);
    };
  }
}
