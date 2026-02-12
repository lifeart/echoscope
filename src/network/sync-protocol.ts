/**
 * NTP-like clock synchronization over DataChannel.
 * Exchanges timestamped ping/pong messages to compute clock offset.
 */

export interface SyncMessage {
  type: 'ping' | 'pong';
  t0: number; // sender's timestamp when ping was sent
  t1?: number; // receiver's timestamp when ping arrived (only in pong)
  t2?: number; // receiver's timestamp when pong was sent (only in pong)
}

export class ClockSync {
  private offsets: number[] = [];
  private smoothedOffset = 0;
  private ewmaAlpha = 0.3;
  private maxSamples = 20;

  /**
   * Create a ping message with current timestamp.
   */
  createPing(): SyncMessage {
    return { type: 'ping', t0: performance.now() / 1000 };
  }

  /**
   * Create a pong response to a received ping.
   */
  createPong(ping: SyncMessage): SyncMessage {
    const now = performance.now() / 1000;
    return {
      type: 'pong',
      t0: ping.t0,
      t1: now,
      t2: now,
    };
  }

  /**
   * Process a received pong to update clock offset.
   * offset = ((t1 - t0) + (t2 - t3)) / 2
   * where t3 is the local time when pong is received.
   */
  processPong(pong: SyncMessage): number {
    const t3 = performance.now() / 1000;
    const t0 = pong.t0;
    const t1 = pong.t1 ?? t3;
    const t2 = pong.t2 ?? t3;

    const offset = ((t1 - t0) + (t2 - t3)) / 2;

    this.offsets.push(offset);
    if (this.offsets.length > this.maxSamples) {
      this.offsets.shift();
    }

    // EWMA smoothing
    this.smoothedOffset = this.smoothedOffset * (1 - this.ewmaAlpha) + offset * this.ewmaAlpha;

    return this.smoothedOffset;
  }

  getOffset(): number {
    return this.smoothedOffset;
  }

  getRoundTripTime(pong: SyncMessage): number {
    const t3 = performance.now() / 1000;
    return (t3 - pong.t0) - ((pong.t2 ?? t3) - (pong.t1 ?? pong.t0));
  }

  reset(): void {
    this.offsets = [];
    this.smoothedOffset = 0;
  }
}
