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

  it('uses simple mean during warmup (first 3 samples)', () => {
    const sync = new ClockSync();
    // Process 3 pongs during warmup
    for (let i = 0; i < 3; i++) {
      const ping = sync.createPing();
      const pong = sync.createPong(ping);
      sync.processPong(pong);
    }
    // After 3 samples the offset should be near zero (local test)
    expect(Math.abs(sync.getOffset())).toBeLessThan(0.1);
  });

  it('rejects outliers after warmup', () => {
    const sync = new ClockSync();
    // Build up a stable baseline of near-zero offsets
    for (let i = 0; i < 5; i++) {
      const ping = sync.createPing();
      const pong = sync.createPong(ping);
      sync.processPong(pong);
    }
    const stableOffset = sync.getOffset();

    // Inject a synthetic outlier pong with a huge offset
    const outlierPong = {
      type: 'pong' as const,
      t0: performance.now() / 1000 - 100, // 100 seconds in the past = huge offset
      t1: performance.now() / 1000,
      t2: performance.now() / 1000,
    };
    sync.processPong(outlierPong);

    // Offset should not have changed much (outlier rejected)
    expect(Math.abs(sync.getOffset() - stableOffset)).toBeLessThan(0.01);
  });

  it('reports not converged with fewer than 3 samples', () => {
    const sync = new ClockSync();
    expect(sync.isConverged()).toBe(false);

    const ping = sync.createPing();
    const pong = sync.createPong(ping);
    sync.processPong(pong);
    expect(sync.isConverged()).toBe(false);
  });

  it('reports converged when last 3 offsets have low variance', () => {
    const sync = new ClockSync();
    // Process several pongs from local (near-zero offset, low variance)
    for (let i = 0; i < 5; i++) {
      const ping = sync.createPing();
      const pong = sync.createPong(ping);
      sync.processPong(pong);
    }
    // Local test should converge since all offsets are near zero
    expect(sync.isConverged()).toBe(true);
  });

  it('getRoundTripTime computes RTT correctly', () => {
    const sync = new ClockSync();
    const ping = sync.createPing();
    const pong = sync.createPong(ping);
    const rtt = sync.getRoundTripTime(pong);
    // RTT should be non-negative and small for a local test
    expect(rtt).toBeGreaterThanOrEqual(0);
    expect(rtt).toBeLessThan(1); // less than 1 second
  });

  it('EWMA smoothing damps offset changes after warmup', () => {
    const sync = new ClockSync();
    // Feed 4 pongs to get past warmup (warmupCount=3)
    for (let i = 0; i < 4; i++) {
      const ping = sync.createPing();
      const pong = sync.createPong(ping);
      sync.processPong(pong);
    }
    const offsetAfterWarmup = sync.getOffset();

    // Now inject a pong with a moderate offset shift
    const shiftedPong = {
      type: 'pong' as const,
      t0: performance.now() / 1000 - 0.01, // 10ms in the past
      t1: performance.now() / 1000,
      t2: performance.now() / 1000,
    };
    sync.processPong(shiftedPong);
    const offsetAfterShift = sync.getOffset();

    // The raw offset would be about 0.005 (half of 10ms), but EWMA should damp the jump.
    // The change from the previous offset should be less than the raw new offset value.
    const rawOffsetApprox = 0.005;
    const actualChange = Math.abs(offsetAfterShift - offsetAfterWarmup);
    // EWMA with alpha=0.3 means change = 0.3 * raw, so it should be damped
    expect(actualChange).toBeLessThan(rawOffsetApprox);
  });

  it('handles pong with missing t1/t2 without crashing', () => {
    const sync = new ClockSync();
    const manualPong = {
      type: 'pong' as const,
      t0: performance.now() / 1000,
      // t1 and t2 are intentionally omitted
    };
    // Should not throw and should return a number
    const offset = sync.processPong(manualPong);
    expect(typeof offset).toBe('number');
    expect(Number.isFinite(offset)).toBe(true);
  });

  it('handles maxSamples eviction without breaking convergence', () => {
    const sync = new ClockSync();
    // Push >20 samples (maxSamples=20) to trigger eviction
    for (let i = 0; i < 25; i++) {
      const ping = sync.createPing();
      const pong = sync.createPong(ping);
      sync.processPong(pong);
    }
    // After 25 local pongs, should still be converged
    expect(sync.isConverged()).toBe(true);
    // Offset should remain finite and near zero for local test
    expect(Number.isFinite(sync.getOffset())).toBe(true);
    expect(Math.abs(sync.getOffset())).toBeLessThan(0.1);
  });
});
