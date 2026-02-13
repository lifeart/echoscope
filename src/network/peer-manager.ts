import { RTCTransport } from './rtc-transport.js';
import { encodeSignal, decodeSignal } from './signaling.js';
import { ClockSync } from './sync-protocol.js';
import { encodeAudioChunk, decodeAudioChunk } from './codec.js';
import { store } from '../core/store.js';
import { bus } from '../core/event-bus.js';
import type { PeerConnectionState, SyncedAudioChunk, ArrayGeometry } from '../types.js';

// Message tag bytes
const TAG_AUDIO = 0x01;
const TAG_CLOCK_SYNC = 0x02;
const TAG_HEARTBEAT = 0x03;
const TAG_GEOMETRY = 0x04;
const TAG_CAPTURE_REQUEST = 0x05;
const TAG_CAPTURE_RESPONSE = 0x06;

// Timing constants
const HEARTBEAT_INTERVAL_MS = 2000;
const HEARTBEAT_TIMEOUT_MS = 6000;
const HEARTBEAT_DISCONNECT_MS = 18000;
const SYNC_WARMUP_INTERVAL_MS = 500;
const SYNC_STEADY_INTERVAL_MS = 3000;
const SYNC_WARMUP_COUNT = 5;
const MAX_CHUNKS_PER_PEER = 8;

interface PeerSession {
  clockSync: ClockSync;
  syncInterval: ReturnType<typeof setInterval> | null;
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  lastChunks: SyncedAudioChunk[];
  state: PeerConnectionState;
  syncCount: number;
}

function tagMessage(tag: number, payload: ArrayBuffer): ArrayBuffer {
  const buf = new ArrayBuffer(1 + payload.byteLength);
  new Uint8Array(buf)[0] = tag;
  new Uint8Array(buf).set(new Uint8Array(payload), 1);
  return buf;
}

function tagMessageFromString(tag: number, str: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(str);
  const buf = new ArrayBuffer(1 + encoded.byteLength);
  new Uint8Array(buf)[0] = tag;
  new Uint8Array(buf).set(encoded, 1);
  return buf;
}

function tagMessageEmpty(tag: number): ArrayBuffer {
  const buf = new ArrayBuffer(1);
  new Uint8Array(buf)[0] = tag;
  return buf;
}

let nextPeerId = 1;

export class PeerManager {
  private transport = new RTCTransport();
  private sessions = new Map<string, PeerSession>();
  private captureRequestHandler: ((peerId: string, data: ArrayBuffer) => void) | null = null;
  private captureResponseHandler: ((peerId: string, data: ArrayBuffer) => void) | null = null;

  constructor() {
    this.transport.onMessage((peerId, data) => this.handleMessage(peerId, data));
    this.transport.onPeerState((peerId, state) => this.handleRtcState(peerId, state));
  }

  async createOffer(): Promise<{ peerId: string; offerText: string }> {
    const peerId = `peer-${nextPeerId++}`;
    const offer = await this.transport.createOffer(peerId);
    this.initSession(peerId);
    return { peerId, offerText: encodeSignal(offer) };
  }

  async acceptOffer(offerText: string): Promise<{ peerId: string; answerText: string }> {
    const peerId = `peer-${nextPeerId++}`;
    const offer = decodeSignal(offerText);
    const answer = await this.transport.acceptOffer(peerId, offer);
    this.initSession(peerId);
    return { peerId, answerText: encodeSignal(answer) };
  }

  async acceptAnswer(peerId: string, answerText: string): Promise<void> {
    const answer = decodeSignal(answerText);
    await this.transport.acceptAnswer(peerId, answer);
  }

  disconnect(peerId: string): void {
    this.cleanupSession(peerId);
    this.transport.disconnect(peerId);
    this.updateStoreFromSessions();
    bus.emit('peer:disconnected', { peerId });
  }

  disconnectAll(): void {
    for (const peerId of this.sessions.keys()) {
      this.cleanupSession(peerId);
    }
    this.transport.disconnectAll();
    this.updateStoreFromSessions();
  }

  sendAudioChunk(channels: Float32Array[], timestamp: number, sampleRate: number): void {
    const probeConfig = store.get().config.probe;
    const encoded = encodeAudioChunk(timestamp, sampleRate, channels, probeConfig);
    const tagged = tagMessage(TAG_AUDIO, encoded);
    this.transport.broadcast(tagged);
  }

  sendCaptureRequest(data: ArrayBuffer): void {
    const tagged = tagMessage(TAG_CAPTURE_REQUEST, data);
    this.transport.broadcast(tagged);
  }

  sendCaptureResponse(peerId: string, data: ArrayBuffer): void {
    const tagged = tagMessage(TAG_CAPTURE_RESPONSE, data);
    this.transport.send(peerId, tagged);
  }

  onCaptureRequest(handler: (peerId: string, data: ArrayBuffer) => void): void {
    this.captureRequestHandler = handler;
  }

  onCaptureResponse(handler: (peerId: string, data: ArrayBuffer) => void): void {
    this.captureResponseHandler = handler;
  }

  getAllRemoteChunks(): SyncedAudioChunk[] {
    const chunks: SyncedAudioChunk[] = [];
    for (const session of this.sessions.values()) {
      chunks.push(...session.lastChunks);
    }
    return chunks;
  }

  getPeerState(peerId: string): PeerConnectionState {
    return this.sessions.get(peerId)?.state ?? 'disconnected';
  }

  getConnectedPeerIds(): string[] {
    const ids: string[] = [];
    for (const [id, session] of this.sessions) {
      if (session.state === 'ready') {
        ids.push(id);
      }
    }
    return ids;
  }

  getPeerCount(): number {
    return this.sessions.size;
  }

  getPeerClockOffset(peerId: string): number {
    return this.sessions.get(peerId)?.clockSync.getOffset() ?? 0;
  }

  getTransport(): RTCTransport {
    return this.transport;
  }

  private initSession(peerId: string): void {
    const session: PeerSession = {
      clockSync: new ClockSync(),
      syncInterval: null,
      heartbeatInterval: null,
      lastChunks: [],
      state: 'connecting',
      syncCount: 0,
    };
    this.sessions.set(peerId, session);
    this.transport.updatePeer(peerId, { state: 'connecting' });
    this.updateStoreFromSessions();
  }

  private transitionState(peerId: string, newState: PeerConnectionState): void {
    const session = this.sessions.get(peerId);
    if (!session || session.state === newState) return;

    session.state = newState;
    this.transport.updatePeer(peerId, { state: newState });

    if (newState === 'ready') {
      bus.emit('peer:connected', { peerId });
    } else if (newState === 'stale') {
      bus.emit('peer:stale', { peerId });
    } else if (newState === 'disconnected') {
      bus.emit('peer:disconnected', { peerId });
    }

    this.updateStoreFromSessions();
  }

  private startSyncing(peerId: string): void {
    const session = this.sessions.get(peerId);
    if (!session) return;

    this.transitionState(peerId, 'syncing');

    // Start clock sync
    const sendSync = () => {
      const ping = session.clockSync.createPing();
      const json = JSON.stringify(ping);
      const msg = tagMessageFromString(TAG_CLOCK_SYNC, json);
      this.transport.send(peerId, msg);
      session.syncCount++;

      // Switch from warmup to steady interval
      if (session.syncCount === SYNC_WARMUP_COUNT && session.syncInterval) {
        clearInterval(session.syncInterval);
        session.syncInterval = setInterval(sendSync, SYNC_STEADY_INTERVAL_MS);
      }
    };

    session.syncInterval = setInterval(sendSync, SYNC_WARMUP_INTERVAL_MS);
    sendSync(); // Send first immediately

    // Start heartbeat
    session.heartbeatInterval = setInterval(() => {
      this.transport.send(peerId, tagMessageEmpty(TAG_HEARTBEAT));
      this.checkHeartbeatTimeout(peerId);
    }, HEARTBEAT_INTERVAL_MS);

    // Send geometry announcement
    const geometry = store.get().geometry;
    const geoMsg = tagMessageFromString(TAG_GEOMETRY, JSON.stringify(geometry));
    this.transport.send(peerId, geoMsg);
  }

  private checkHeartbeatTimeout(peerId: string): void {
    const session = this.sessions.get(peerId);
    if (!session) return;

    const peers = this.transport.getPeers();
    const peer = peers.get(peerId);
    if (!peer) return;

    const elapsed = Date.now() - peer.lastHeartbeat;

    if (elapsed > HEARTBEAT_DISCONNECT_MS) {
      this.disconnect(peerId);
    } else if (elapsed > HEARTBEAT_TIMEOUT_MS && session.state === 'ready') {
      this.transitionState(peerId, 'stale');
    }
  }

  private handleMessage(peerId: string, data: ArrayBuffer): void {
    if (data.byteLength < 1) return;

    const tag = new Uint8Array(data)[0];
    const payload = data.slice(1);

    // Update heartbeat on any message
    this.transport.updatePeer(peerId, { lastHeartbeat: Date.now() });

    // If stale, recover to ready
    const session = this.sessions.get(peerId);
    if (session?.state === 'stale') {
      this.transitionState(peerId, 'ready');
    }

    switch (tag) {
      case TAG_AUDIO:
        this.handleAudioChunk(peerId, payload);
        break;
      case TAG_CLOCK_SYNC:
        this.handleClockSync(peerId, payload);
        break;
      case TAG_HEARTBEAT:
        // Heartbeat acknowledged by lastHeartbeat update above
        break;
      case TAG_GEOMETRY:
        this.handleGeometry(peerId, payload);
        break;
      case TAG_CAPTURE_REQUEST:
        this.captureRequestHandler?.(peerId, payload);
        break;
      case TAG_CAPTURE_RESPONSE:
        this.captureResponseHandler?.(peerId, payload);
        break;
    }
  }

  private handleAudioChunk(peerId: string, payload: ArrayBuffer): void {
    const decoded = decodeAudioChunk(payload);
    if (!decoded) return;

    const session = this.sessions.get(peerId);
    if (!session) return;

    const chunk: SyncedAudioChunk = {
      peerId,
      timestamp: decoded.timestamp - session.clockSync.getOffset(),
      sampleRate: decoded.sampleRate,
      channels: decoded.channels,
      probeConfig: store.get().config.probe,
    };

    session.lastChunks.push(chunk);
    if (session.lastChunks.length > MAX_CHUNKS_PER_PEER) {
      session.lastChunks.shift();
    }

    bus.emit('peer:data', chunk);
  }

  private handleClockSync(peerId: string, payload: ArrayBuffer): void {
    const session = this.sessions.get(peerId);
    if (!session) return;

    let msg: { type: 'ping' | 'pong'; t0: number; t1?: number; t2?: number };
    try {
      const json = new TextDecoder().decode(payload);
      msg = JSON.parse(json);
    } catch {
      return; // Malformed clock sync message
    }

    if (msg.type === 'ping') {
      const pong = session.clockSync.createPong(msg);
      const reply = tagMessageFromString(TAG_CLOCK_SYNC, JSON.stringify(pong));
      this.transport.send(peerId, reply);
    } else if (msg.type === 'pong') {
      const offset = session.clockSync.processPong(msg);
      this.transport.updatePeer(peerId, { clockOffset: offset });

      if (session.state === 'syncing' && session.clockSync.isConverged()) {
        this.transitionState(peerId, 'ready');
      }
    }
  }

  private handleGeometry(peerId: string, payload: ArrayBuffer): void {
    let geometry: ArrayGeometry;
    try {
      const json = new TextDecoder().decode(payload);
      geometry = JSON.parse(json);
    } catch {
      return; // Malformed geometry message
    }
    this.transport.updatePeer(peerId, { geometry });
  }

  private handleRtcState(peerId: string, state: RTCPeerConnectionState): void {
    if (state === 'connected') {
      const session = this.sessions.get(peerId);
      if (session && session.state === 'connecting') {
        this.startSyncing(peerId);
      }
    } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
      // Guard against recursive disconnect (session already cleaned up)
      if (!this.sessions.has(peerId)) return;
      this.disconnect(peerId);
    }
  }

  private cleanupSession(peerId: string): void {
    const session = this.sessions.get(peerId);
    if (!session) return;
    if (session.syncInterval) clearInterval(session.syncInterval);
    if (session.heartbeatInterval) clearInterval(session.heartbeatInterval);
    this.sessions.delete(peerId);
  }

  private updateStoreFromSessions(): void {
    const peers = this.transport.getPeers();
    store.update(s => { s.peers = peers; });
  }
}

export const peerManager = new PeerManager();
