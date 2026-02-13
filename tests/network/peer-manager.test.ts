import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Captured callbacks from RTCTransport ---
// Use vi.hoisted so variables are available inside hoisted vi.mock factories.
const callbacks = vi.hoisted(() => ({
  messageCallback: null as ((peerId: string, data: ArrayBuffer) => void) | null,
  stateCallback: null as ((peerId: string, state: string) => void) | null,
}));

// Factory functions hoisted so they survive vi.clearAllMocks and can be re-applied.
const factories = vi.hoisted(() => ({
  createTransportInstance: () => ({
    onMessage: vi.fn((cb: any) => { callbacks.messageCallback = cb; }),
    onPeerState: vi.fn((cb: any) => { callbacks.stateCallback = cb; }),
    createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-sdp' }),
    acceptOffer: vi.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-sdp' }),
    acceptAnswer: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockReturnValue(true),
    broadcast: vi.fn(),
    disconnect: vi.fn(),
    disconnectAll: vi.fn(),
    getPeers: vi.fn().mockReturnValue(new Map()),
    updatePeer: vi.fn(),
  }),
  createClockSyncInstance: () => {
    let count = 0;
    return {
      createPing: vi.fn(() => ({ type: 'ping', t0: performance.now() / 1000 })),
      createPong: vi.fn((msg: any) => ({
        type: 'pong',
        t0: msg.t0,
        t1: performance.now() / 1000,
        t2: performance.now() / 1000,
      })),
      processPong: vi.fn(() => { count++; return 0.001; }),
      getOffset: vi.fn(() => 0.005),
      isConverged: vi.fn(() => count >= 3),
      getRoundTripTime: vi.fn(() => 0.002),
      reset: vi.fn(),
    };
  },
}));

// Mock dependencies
vi.mock('../../src/network/rtc-transport.js', () => {
  const MockTransport = vi.fn().mockImplementation(() => factories.createTransportInstance());
  return { RTCTransport: MockTransport };
});

vi.mock('../../src/network/signaling.js', () => ({
  encodeSignal: vi.fn((desc: any) => btoa(JSON.stringify(desc))),
  decodeSignal: vi.fn((text: string) => JSON.parse(atob(text))),
}));


// Mock ClockSync so we can control convergence per instance
vi.mock('../../src/network/sync-protocol.js', () => {
  return {
    ClockSync: vi.fn().mockImplementation(() => factories.createClockSyncInstance()),
  };
});

vi.mock('../../src/core/store.js', () => ({
  store: {
    get: vi.fn().mockReturnValue({
      config: {
        probe: { type: 'chirp', params: { f1: 2000, f2: 9000, durationMs: 7 } },
      },
      geometry: {
        speakers: [{ x: -0.1, y: 0, z: 0 }],
        microphones: [{ x: 0, y: 0, z: 0 }],
        spacing: 0.2,
        speedOfSound: 343,
      },
    }),
    update: vi.fn(),
  },
}));

vi.mock('../../src/core/event-bus.js', () => ({
  bus: {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

import { PeerManager } from '../../src/network/peer-manager.js';
import { bus } from '../../src/core/event-bus.js';

// --- Helpers ---

/** Build a tagged binary message: [tag byte][payload bytes] */
function buildTaggedMessage(tag: number, payload: ArrayBuffer | Uint8Array): ArrayBuffer {
  const p = payload instanceof ArrayBuffer ? new Uint8Array(payload) : payload;
  const buf = new ArrayBuffer(1 + p.byteLength);
  new Uint8Array(buf)[0] = tag;
  new Uint8Array(buf).set(p, 1);
  return buf;
}

/** Build a tagged message from a string payload */
function buildTaggedStringMessage(tag: number, str: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(str);
  return buildTaggedMessage(tag, encoded);
}

/** Build a tagged message with no payload (just the tag byte) */
function buildTaggedEmptyMessage(tag: number): ArrayBuffer {
  const buf = new ArrayBuffer(1);
  new Uint8Array(buf)[0] = tag;
  return buf;
}

// Tag constants
const TAG_CLOCK_SYNC = 0x02;
const TAG_HEARTBEAT = 0x03;
const TAG_GEOMETRY = 0x04;
const TAG_CAPTURE_REQUEST = 0x05;
const TAG_CAPTURE_RESPONSE = 0x06;

describe('PeerManager', () => {
  let pm: PeerManager;

  beforeEach(() => {
    // Don't use vi.clearAllMocks() - it clears mockImplementation on module-level
    // constructor mocks (RTCTransport, ClockSync), breaking new PeerManager().
    // Instead, clear specific instance mocks we care about.
    vi.mocked(bus.emit).mockClear();
    vi.mocked(bus.on).mockClear();
    vi.mocked(bus.off).mockClear();
    callbacks.messageCallback = null;
    callbacks.stateCallback = null;
    pm = new PeerManager();
  });

  afterEach(() => {
    // Note: do NOT call vi.restoreAllMocks() here - it removes mockImplementation
    // from the module-level mock constructors (RTCTransport, ClockSync), which would
    // break new PeerManager() creation in subsequent tests.
  });

  it('createOffer returns peerId and encoded offer text', async () => {
    const { peerId, offerText } = await pm.createOffer();
    expect(peerId).toMatch(/^peer-/);
    expect(offerText.length).toBeGreaterThan(0);
  });

  it('acceptOffer returns peerId and encoded answer text', async () => {
    const offerText = btoa(JSON.stringify({ type: 'offer', sdp: 'test' }));
    const { peerId, answerText } = await pm.acceptOffer(offerText);
    expect(peerId).toMatch(/^peer-/);
    expect(answerText.length).toBeGreaterThan(0);
  });

  it('getPeerState returns disconnected for unknown peer', () => {
    expect(pm.getPeerState('unknown')).toBe('disconnected');
  });

  it('getPeerCount returns 0 initially', () => {
    expect(pm.getPeerCount()).toBe(0);
  });

  it('getConnectedPeerIds returns empty initially', () => {
    expect(pm.getConnectedPeerIds()).toEqual([]);
  });

  it('disconnect emits peer:disconnected', async () => {
    const { peerId } = await pm.createOffer();
    pm.disconnect(peerId);
    expect(bus.emit).toHaveBeenCalledWith('peer:disconnected', { peerId });
  });

  it('disconnectAll cleans up all sessions', async () => {
    await pm.createOffer();
    await pm.createOffer();
    pm.disconnectAll();
    expect(pm.getPeerCount()).toBe(0);
  });

  it('onCaptureRequest registers handler', () => {
    const handler = vi.fn();
    pm.onCaptureRequest(handler);
    // Handler is stored internally
    expect(handler).not.toHaveBeenCalled();
  });

  it('onCaptureResponse registers handler', () => {
    const handler = vi.fn();
    pm.onCaptureResponse(handler);
    expect(handler).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // State machine tests
  // -------------------------------------------------------------------------

  describe('state machine transitions', () => {
    it('connecting -> syncing on RTC connected', async () => {
      const { peerId } = await pm.createOffer();

      // After createOffer, peer should be in 'connecting' state
      expect(pm.getPeerState(peerId)).toBe('connecting');

      // Simulate RTC connection established
      expect(callbacks.stateCallback).not.toBeNull();
      callbacks.stateCallback!(peerId, 'connected');

      // Should transition to 'syncing'
      expect(pm.getPeerState(peerId)).toBe('syncing');

      // Verify the transport was updated
      const transport = pm.getTransport();
      expect(transport.updatePeer).toHaveBeenCalledWith(peerId, { state: 'syncing' });
    });

    it('syncing -> ready on clock convergence', async () => {
      vi.useFakeTimers();
      try {
        const { peerId } = await pm.createOffer();
        callbacks.stateCallback!(peerId, 'connected');
        expect(pm.getPeerState(peerId)).toBe('syncing');

        // The mock ClockSync.isConverged() returns true after 3 processPong() calls.
        // We need to send 3 pong messages via messageCallback.
        // startSyncing() calls sendSync() immediately and sets an interval.
        // The PeerManager sends pings, remote responds with pongs.
        // We simulate 3 pong arrivals.

        // Find the clock sync ping that was sent by startSyncing
        // The format is tagMessageFromString(TAG_CLOCK_SYNC, JSON.stringify(ping))
        // We need to extract t0 from the sent pings, then craft matching pongs.

        // Actually, since ClockSync is fully mocked, processPong doesn't use real t0.
        // We just need to deliver pong messages so handleClockSync dispatches to processPong.

        for (let i = 0; i < 3; i++) {
          const pong = JSON.stringify({ type: 'pong', t0: 0.1, t1: 0.1, t2: 0.1 });
          const msg = buildTaggedStringMessage(TAG_CLOCK_SYNC, pong);
          callbacks.messageCallback!(peerId, msg);
        }

        // After 3 pongs, mock isConverged returns true, should transition to 'ready'
        expect(pm.getPeerState(peerId)).toBe('ready');
        expect(bus.emit).toHaveBeenCalledWith('peer:connected', { peerId });
      } finally {
        vi.useRealTimers();
      }
    });

    it('stays in syncing if clock has not converged', async () => {
      vi.useFakeTimers();
      try {
        const { peerId } = await pm.createOffer();
        callbacks.stateCallback!(peerId, 'connected');
        expect(pm.getPeerState(peerId)).toBe('syncing');

        // Send only 2 pongs (need 3 for convergence)
        for (let i = 0; i < 2; i++) {
          const pong = JSON.stringify({ type: 'pong', t0: 0.1, t1: 0.1, t2: 0.1 });
          const msg = buildTaggedStringMessage(TAG_CLOCK_SYNC, pong);
          callbacks.messageCallback!(peerId, msg);
        }

        // Should still be 'syncing' because isConverged returns false with count < 3
        expect(pm.getPeerState(peerId)).toBe('syncing');
      } finally {
        vi.useRealTimers();
      }
    });

    it('RTC connected does nothing if state is not connecting', async () => {
      vi.useFakeTimers();
      try {
        const { peerId } = await pm.createOffer();
        callbacks.stateCallback!(peerId, 'connected');
        expect(pm.getPeerState(peerId)).toBe('syncing');

        // Clear mocks so we can check no new transitions happen
        vi.mocked(bus.emit).mockClear();
        const transport = pm.getTransport();
        vi.mocked(transport.updatePeer).mockClear();

        // Invoking 'connected' again should not re-enter startSyncing
        callbacks.stateCallback!(peerId, 'connected');

        // Should still be syncing and no new state update emitted
        expect(pm.getPeerState(peerId)).toBe('syncing');
        // updatePeer should NOT have been called with state: 'syncing' again
        const stateCalls = vi.mocked(transport.updatePeer).mock.calls
          .filter(c => (c[1] as any)?.state);
        expect(stateCalls).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // -------------------------------------------------------------------------
  // handleRtcState disconnection
  // -------------------------------------------------------------------------

  describe('handleRtcState disconnection', () => {
    it('disconnected triggers disconnect and emits peer:disconnected', async () => {
      const { peerId } = await pm.createOffer();
      expect(pm.getPeerCount()).toBe(1);

      callbacks.stateCallback!(peerId, 'disconnected');

      expect(bus.emit).toHaveBeenCalledWith('peer:disconnected', { peerId });
      expect(pm.getPeerCount()).toBe(0);
    });

    it('failed triggers disconnect', async () => {
      const { peerId } = await pm.createOffer();
      callbacks.stateCallback!(peerId, 'failed');

      expect(bus.emit).toHaveBeenCalledWith('peer:disconnected', { peerId });
      expect(pm.getPeerCount()).toBe(0);
    });

    it('closed triggers disconnect', async () => {
      const { peerId } = await pm.createOffer();
      callbacks.stateCallback!(peerId, 'closed');

      expect(bus.emit).toHaveBeenCalledWith('peer:disconnected', { peerId });
      expect(pm.getPeerCount()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Guard against recursive disconnect
  // -------------------------------------------------------------------------

  describe('recursive disconnect guard', () => {
    it('does not throw when stateCallback fires disconnected after explicit disconnect', async () => {
      const { peerId } = await pm.createOffer();

      // Explicitly disconnect (cleans up session)
      pm.disconnect(peerId);
      expect(pm.getPeerCount()).toBe(0);

      // RTC fires 'disconnected' after session is already removed
      // Should not throw and should not call disconnect again
      expect(() => callbacks.stateCallback!(peerId, 'disconnected')).not.toThrow();
      expect(pm.getPeerCount()).toBe(0);
    });

    it('does not emit peer:disconnected twice for same peer', async () => {
      const { peerId } = await pm.createOffer();

      pm.disconnect(peerId);

      // Clear mocks to count only further calls
      vi.mocked(bus.emit).mockClear();

      callbacks.stateCallback!(peerId, 'disconnected');

      // bus.emit should NOT have been called again with peer:disconnected
      const disconnectedCalls = vi.mocked(bus.emit).mock.calls
        .filter(c => c[0] === 'peer:disconnected');
      expect(disconnectedCalls).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Message handling tests
  // -------------------------------------------------------------------------

  describe('handleMessage', () => {
    it('updates lastHeartbeat on any message', async () => {
      vi.useFakeTimers();
      try {
        const { peerId } = await pm.createOffer();
        callbacks.stateCallback!(peerId, 'connected');

        const transport = pm.getTransport();
        vi.mocked(transport.updatePeer).mockClear();

        // Send a heartbeat message
        const msg = buildTaggedEmptyMessage(TAG_HEARTBEAT);
        callbacks.messageCallback!(peerId, msg);

        // updatePeer should be called with lastHeartbeat
        expect(transport.updatePeer).toHaveBeenCalledWith(
          peerId,
          expect.objectContaining({ lastHeartbeat: expect.any(Number) }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('ignores empty messages (byteLength < 1)', async () => {
      const { peerId } = await pm.createOffer();
      callbacks.stateCallback!(peerId, 'connected');

      const transport = pm.getTransport();
      vi.mocked(transport.updatePeer).mockClear();

      // Send empty buffer
      callbacks.messageCallback!(peerId, new ArrayBuffer(0));

      // updatePeer should NOT be called for heartbeat (message was ignored)
      const heartbeatCalls = vi.mocked(transport.updatePeer).mock.calls
        .filter(c => (c[1] as any)?.lastHeartbeat !== undefined);
      expect(heartbeatCalls).toHaveLength(0);
    });

    it('clock sync ping received sends pong back', async () => {
      vi.useFakeTimers();
      try {
        const { peerId } = await pm.createOffer();
        callbacks.stateCallback!(peerId, 'connected');

        const transport = pm.getTransport();
        vi.mocked(transport.send).mockClear();

        // Send a ping message (simulating remote peer sending us a clock sync ping)
        const ping = JSON.stringify({ type: 'ping', t0: 0.5 });
        const msg = buildTaggedStringMessage(TAG_CLOCK_SYNC, ping);
        callbacks.messageCallback!(peerId, msg);

        // PeerManager should respond with a pong via transport.send
        const sendCalls = vi.mocked(transport.send).mock.calls
          .filter(c => c[0] === peerId);
        // Should have at least one send call with a clock sync pong
        const clockSyncSends = sendCalls.filter(c => {
          const data = c[1] as ArrayBuffer;
          return new Uint8Array(data)[0] === TAG_CLOCK_SYNC;
        });
        expect(clockSyncSends.length).toBeGreaterThanOrEqual(1);

        // Verify pong content
        const pongBuf = clockSyncSends[clockSyncSends.length - 1][1] as ArrayBuffer;
        const pongPayload = new TextDecoder().decode(pongBuf.slice(1));
        const pongObj = JSON.parse(pongPayload);
        expect(pongObj.type).toBe('pong');
        expect(pongObj.t0).toBe(0.5);
      } finally {
        vi.useRealTimers();
      }
    });

    it('malformed clock sync message does not throw', async () => {
      const { peerId } = await pm.createOffer();
      callbacks.stateCallback!(peerId, 'connected');

      // Send garbled clock sync message (invalid JSON)
      const garbled = new TextEncoder().encode('not-json{{{');
      const msg = buildTaggedMessage(TAG_CLOCK_SYNC, garbled);
      expect(() => callbacks.messageCallback!(peerId, msg)).not.toThrow();
    });

    it('geometry message updates transport peer with geometry', async () => {
      vi.useFakeTimers();
      try {
        const { peerId } = await pm.createOffer();
        callbacks.stateCallback!(peerId, 'connected');

        const transport = pm.getTransport();
        vi.mocked(transport.updatePeer).mockClear();

        const geometry = {
          speakers: [{ x: 0.1, y: 0, z: 0 }],
          microphones: [{ x: -0.1, y: 0, z: 0 }],
          spacing: 0.2,
          speedOfSound: 343,
        };
        const msg = buildTaggedStringMessage(TAG_GEOMETRY, JSON.stringify(geometry));
        callbacks.messageCallback!(peerId, msg);

        expect(transport.updatePeer).toHaveBeenCalledWith(
          peerId,
          expect.objectContaining({ geometry }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('malformed geometry message does not throw', async () => {
      const { peerId } = await pm.createOffer();
      callbacks.stateCallback!(peerId, 'connected');

      const garbled = new TextEncoder().encode('{malformed');
      const msg = buildTaggedMessage(TAG_GEOMETRY, garbled);
      expect(() => callbacks.messageCallback!(peerId, msg)).not.toThrow();
    });

    it('capture request invokes registered handler', async () => {
      const { peerId } = await pm.createOffer();
      callbacks.stateCallback!(peerId, 'connected');

      const handler = vi.fn();
      pm.onCaptureRequest(handler);

      const payload = new Uint8Array([0xAA, 0xBB]);
      const msg = buildTaggedMessage(TAG_CAPTURE_REQUEST, payload);
      callbacks.messageCallback!(peerId, msg);

      expect(handler).toHaveBeenCalledWith(peerId, expect.any(ArrayBuffer));
    });

    it('capture response invokes registered handler', async () => {
      const { peerId } = await pm.createOffer();
      callbacks.stateCallback!(peerId, 'connected');

      const handler = vi.fn();
      pm.onCaptureResponse(handler);

      const payload = new Uint8Array([0xCC, 0xDD]);
      const msg = buildTaggedMessage(TAG_CAPTURE_RESPONSE, payload);
      callbacks.messageCallback!(peerId, msg);

      expect(handler).toHaveBeenCalledWith(peerId, expect.any(ArrayBuffer));
    });

    it('capture request without handler does not throw', async () => {
      const { peerId } = await pm.createOffer();
      callbacks.stateCallback!(peerId, 'connected');

      const payload = new Uint8Array([0x01]);
      const msg = buildTaggedMessage(TAG_CAPTURE_REQUEST, payload);
      expect(() => callbacks.messageCallback!(peerId, msg)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Stale recovery
  // -------------------------------------------------------------------------

  describe('stale recovery', () => {
    it('receiving a message when stale transitions back to ready', async () => {
      vi.useFakeTimers();
      try {
        const { peerId } = await pm.createOffer();
        callbacks.stateCallback!(peerId, 'connected');

        // Drive to ready
        for (let i = 0; i < 3; i++) {
          const pong = JSON.stringify({ type: 'pong', t0: 0.1, t1: 0.1, t2: 0.1 });
          callbacks.messageCallback!(peerId, buildTaggedStringMessage(TAG_CLOCK_SYNC, pong));
        }
        expect(pm.getPeerState(peerId)).toBe('ready');

        // We need to get the peer into 'stale' state.
        // checkHeartbeatTimeout checks elapsed > HEARTBEAT_TIMEOUT_MS (6000ms).
        // It reads lastHeartbeat from transport.getPeers().get(peerId).
        // The heartbeat interval fires every 2000ms.

        // Setup getPeers to return a peer with old lastHeartbeat
        const transport = pm.getTransport();
        const staleTimestamp = Date.now() - 7000; // 7 seconds ago (> 6000 timeout)
        vi.mocked(transport.getPeers).mockReturnValue(
          new Map([[peerId, { lastHeartbeat: staleTimestamp } as any]]),
        );

        // Advance time to trigger heartbeat interval (fires every 2000ms)
        // startSyncing set up the heartbeat interval. We need to advance enough.
        vi.advanceTimersByTime(2000);

        // After heartbeat fires, checkHeartbeatTimeout should detect stale
        expect(pm.getPeerState(peerId)).toBe('stale');
        expect(bus.emit).toHaveBeenCalledWith('peer:stale', { peerId });

        // Now send any message to recover
        vi.mocked(bus.emit).mockClear();
        const msg = buildTaggedEmptyMessage(TAG_HEARTBEAT);
        callbacks.messageCallback!(peerId, msg);

        // Should recover to 'ready'
        expect(pm.getPeerState(peerId)).toBe('ready');
        expect(bus.emit).toHaveBeenCalledWith('peer:connected', { peerId });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Heartbeat timeout -> disconnect
  // -------------------------------------------------------------------------

  describe('heartbeat timeout disconnect', () => {
    it('disconnects peer when heartbeat exceeds HEARTBEAT_DISCONNECT_MS', async () => {
      vi.useFakeTimers();
      try {
        const { peerId } = await pm.createOffer();
        callbacks.stateCallback!(peerId, 'connected');

        // Drive to ready
        for (let i = 0; i < 3; i++) {
          const pong = JSON.stringify({ type: 'pong', t0: 0.1, t1: 0.1, t2: 0.1 });
          callbacks.messageCallback!(peerId, buildTaggedStringMessage(TAG_CLOCK_SYNC, pong));
        }
        expect(pm.getPeerState(peerId)).toBe('ready');

        // Setup getPeers with a very old heartbeat (> 18000ms)
        const transport = pm.getTransport();
        vi.mocked(transport.getPeers).mockReturnValue(
          new Map([[peerId, { lastHeartbeat: Date.now() - 19000 } as any]]),
        );

        vi.mocked(bus.emit).mockClear();

        // Advance to trigger heartbeat check
        vi.advanceTimersByTime(2000);

        expect(pm.getPeerCount()).toBe(0);
        expect(bus.emit).toHaveBeenCalledWith('peer:disconnected', { peerId });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Syncing sends geometry announcement
  // -------------------------------------------------------------------------

  describe('syncing behavior', () => {
    it('sends geometry announcement on RTC connected', async () => {
      vi.useFakeTimers();
      try {
        const { peerId } = await pm.createOffer();
        const transport = pm.getTransport();
        vi.mocked(transport.send).mockClear();

        callbacks.stateCallback!(peerId, 'connected');

        // Find the geometry send call
        const sendCalls = vi.mocked(transport.send).mock.calls.filter(c => {
          const data = c[1] as ArrayBuffer;
          return new Uint8Array(data)[0] === TAG_GEOMETRY;
        });
        expect(sendCalls).toHaveLength(1);
        expect(sendCalls[0][0]).toBe(peerId);

        // Verify geometry content
        const geoBuf = sendCalls[0][1] as ArrayBuffer;
        const geoPayload = new TextDecoder().decode(geoBuf.slice(1));
        const geometry = JSON.parse(geoPayload);
        expect(geometry.speakers).toBeDefined();
        expect(geometry.microphones).toBeDefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('sends clock sync ping immediately on RTC connected', async () => {
      vi.useFakeTimers();
      try {
        const { peerId } = await pm.createOffer();
        const transport = pm.getTransport();
        vi.mocked(transport.send).mockClear();

        callbacks.stateCallback!(peerId, 'connected');

        // Find the clock sync send call
        const clockSyncCalls = vi.mocked(transport.send).mock.calls.filter(c => {
          const data = c[1] as ArrayBuffer;
          return new Uint8Array(data)[0] === TAG_CLOCK_SYNC;
        });
        expect(clockSyncCalls.length).toBeGreaterThanOrEqual(1);

        // Verify ping content
        const pingBuf = clockSyncCalls[0][1] as ArrayBuffer;
        const pingPayload = new TextDecoder().decode(pingBuf.slice(1));
        const pingObj = JSON.parse(pingPayload);
        expect(pingObj.type).toBe('ping');
        expect(pingObj.t0).toEqual(expect.any(Number));
      } finally {
        vi.useRealTimers();
      }
    });

    it('switches from warmup to steady sync interval after SYNC_WARMUP_COUNT pings', async () => {
      vi.useFakeTimers();
      try {
        const { peerId } = await pm.createOffer();
        const transport = pm.getTransport();

        callbacks.stateCallback!(peerId, 'connected');

        // startSyncing fires immediately + interval every 500ms (warmup)
        // After 5 pings it should switch to 3000ms interval

        vi.mocked(transport.send).mockClear();

        // Advance through warmup: 4 more intervals (first ping was immediate)
        // Interval fires at 500, 1000, 1500, 2000 = 4 more pings = 5 total
        vi.advanceTimersByTime(2000);

        const clockPings = vi.mocked(transport.send).mock.calls.filter(c => {
          const data = c[1] as ArrayBuffer;
          if (data.byteLength < 1) return false;
          const tag = new Uint8Array(data)[0];
          if (tag !== TAG_CLOCK_SYNC) return false;
          try {
            const payload = new TextDecoder().decode(data.slice(1));
            const obj = JSON.parse(payload);
            return obj.type === 'ping';
          } catch { return false; }
        });

        // Should have fired 4 pings during the 2000ms (at 500, 1000, 1500, 2000)
        expect(clockPings.length).toBe(4);

        // Now clear and advance 3000ms - should fire on new steady interval
        vi.mocked(transport.send).mockClear();
        vi.advanceTimersByTime(3000);

        const steadyPings = vi.mocked(transport.send).mock.calls.filter(c => {
          const data = c[1] as ArrayBuffer;
          if (data.byteLength < 1) return false;
          const tag = new Uint8Array(data)[0];
          if (tag !== TAG_CLOCK_SYNC) return false;
          try {
            const payload = new TextDecoder().decode(data.slice(1));
            const obj = JSON.parse(payload);
            return obj.type === 'ping';
          } catch { return false; }
        });

        // At steady interval of 3000ms, should get exactly 1 ping in 3000ms
        expect(steadyPings.length).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // -------------------------------------------------------------------------
  // getConnectedPeerIds only includes ready peers
  // -------------------------------------------------------------------------

  describe('getConnectedPeerIds', () => {
    it('excludes peers in syncing state', async () => {
      const { peerId } = await pm.createOffer();
      callbacks.stateCallback!(peerId, 'connected');
      expect(pm.getPeerState(peerId)).toBe('syncing');
      expect(pm.getConnectedPeerIds()).not.toContain(peerId);
    });

    it('includes peers in ready state', async () => {
      vi.useFakeTimers();
      try {
        const { peerId } = await pm.createOffer();
        callbacks.stateCallback!(peerId, 'connected');

        // Drive to ready
        for (let i = 0; i < 3; i++) {
          const pong = JSON.stringify({ type: 'pong', t0: 0.1, t1: 0.1, t2: 0.1 });
          callbacks.messageCallback!(peerId, buildTaggedStringMessage(TAG_CLOCK_SYNC, pong));
        }
        expect(pm.getPeerState(peerId)).toBe('ready');
        expect(pm.getConnectedPeerIds()).toContain(peerId);
      } finally {
        vi.useRealTimers();
      }
    });

    it('excludes peers in connecting state', async () => {
      const { peerId } = await pm.createOffer();
      expect(pm.getPeerState(peerId)).toBe('connecting');
      expect(pm.getConnectedPeerIds()).not.toContain(peerId);
    });
  });

  // -------------------------------------------------------------------------
  // getPeerClockOffset
  // -------------------------------------------------------------------------

  describe('getPeerClockOffset', () => {
    it('returns clock offset for known peer', async () => {
      const { peerId } = await pm.createOffer();
      // Mock getOffset returns 0.005
      expect(pm.getPeerClockOffset(peerId)).toBe(0.005);
    });

    it('returns 0 for unknown peer', () => {
      expect(pm.getPeerClockOffset('nonexistent')).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // acceptAnswer delegates to transport
  // -------------------------------------------------------------------------

  describe('acceptAnswer', () => {
    it('delegates to transport.acceptAnswer', async () => {
      const { peerId } = await pm.createOffer();
      const answerText = btoa(JSON.stringify({ type: 'answer', sdp: 'test-sdp' }));
      await pm.acceptAnswer(peerId, answerText);

      const transport = pm.getTransport();
      expect(transport.acceptAnswer).toHaveBeenCalledWith(
        peerId,
        { type: 'answer', sdp: 'test-sdp' },
      );
    });
  });

  // -------------------------------------------------------------------------
  // sendCaptureRequest and sendCaptureResponse
  // -------------------------------------------------------------------------

  describe('capture request/response sending', () => {
    it('sendCaptureRequest broadcasts tagged message', () => {
      const data = new ArrayBuffer(4);
      pm.sendCaptureRequest(data);

      const transport = pm.getTransport();
      expect(transport.broadcast).toHaveBeenCalledTimes(1);
      const sentBuf = vi.mocked(transport.broadcast).mock.calls[0][0] as ArrayBuffer;
      expect(new Uint8Array(sentBuf)[0]).toBe(TAG_CAPTURE_REQUEST);
    });

    it('sendCaptureResponse sends tagged message to specific peer', async () => {
      const { peerId } = await pm.createOffer();
      const data = new ArrayBuffer(4);
      pm.sendCaptureResponse(peerId, data);

      const transport = pm.getTransport();
      const sendCalls = vi.mocked(transport.send).mock.calls
        .filter(c => c[0] === peerId);
      expect(sendCalls.length).toBeGreaterThanOrEqual(1);
      const lastSend = sendCalls[sendCalls.length - 1];
      expect(new Uint8Array(lastSend[1] as ArrayBuffer)[0]).toBe(TAG_CAPTURE_RESPONSE);
    });
  });
});
