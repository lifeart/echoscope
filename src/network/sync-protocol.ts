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
  private warmupCount = 3;

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

    // Outlier rejection using MAD (median absolute deviation)
    if (this.offsets.length >= this.warmupCount) {
      const med = this.medianOffset();
      const mad = this.madOffset();
      if (mad > 1e-9) {
        const modifiedZ = 0.6745 * Math.abs(offset - med) / mad;
        if (modifiedZ > 3.5) {
          // Reject outlier, return current smoothed offset
          return this.smoothedOffset;
        }
      }
    }

    this.offsets.push(offset);
    if (this.offsets.length > this.maxSamples) {
      this.offsets.shift();
    }

    // Use simple mean for warmup, EWMA after
    if (this.offsets.length <= this.warmupCount) {
      let sum = 0;
      for (const o of this.offsets) sum += o;
      this.smoothedOffset = sum / this.offsets.length;
    } else {
      this.smoothedOffset = this.smoothedOffset * (1 - this.ewmaAlpha) + offset * this.ewmaAlpha;
    }

    return this.smoothedOffset;
  }

  getOffset(): number {
    return this.smoothedOffset;
  }

  getRoundTripTime(pong: SyncMessage): number {
    const t3 = performance.now() / 1000;
    return (t3 - pong.t0) - ((pong.t2 ?? t3) - (pong.t1 ?? pong.t0));
  }

  /**
   * True when stddev of last 3 offsets < 1ms.
   */
  isConverged(): boolean {
    if (this.offsets.length < 3) return false;
    const last3 = this.offsets.slice(-3);
    let sum = 0;
    for (const o of last3) sum += o;
    const mean = sum / 3;
    let variance = 0;
    for (const o of last3) variance += (o - mean) * (o - mean);
    const stddev = Math.sqrt(variance / 3);
    return stddev < 0.001; // 1ms threshold
  }

  reset(): void {
    this.offsets = [];
    this.smoothedOffset = 0;
  }

  private medianOffset(): number {
    const sorted = [...this.offsets].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  private madOffset(): number {
    const med = this.medianOffset();
    const deviations = this.offsets.map(o => Math.abs(o - med));
    const sorted = deviations.sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }
}
