import { ClockSync } from '../../src/network/sync-protocol.js';

describe('ClockSync', () => {
  it('creates ping with timestamp', () => {
    const sync = new ClockSync();
    const ping = sync.createPing();
    expect(ping.type).toBe('ping');
    expect(ping.t0).toBeGreaterThan(0);
  });

  it('creates pong from ping', () => {
    const sync = new ClockSync();
    const ping = sync.createPing();
    const pong = sync.createPong(ping);
    expect(pong.type).toBe('pong');
    expect(pong.t0).toBe(ping.t0);
    expect(pong.t1).toBeDefined();
    expect(pong.t2).toBeDefined();
  });

  it('computes offset from pong', () => {
    const sync = new ClockSync();
    const ping = sync.createPing();
    const pong = sync.createPong(ping);
    const offset = sync.processPong(pong);
    // Offset should be close to zero for local test
    expect(Math.abs(offset)).toBeLessThan(1);
  });

  it('resets state', () => {
    const sync = new ClockSync();
    const ping = sync.createPing();
    const pong = sync.createPong(ping);
    sync.processPong(pong);
    sync.reset();
    expect(sync.getOffset()).toBe(0);
  });
});
