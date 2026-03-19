/**
 * Single-threaded circular buffer for multichannel audio capture.
 *
 * Thread-safety note: push() and read() are expected to run on the
 * **same** JS thread (main thread, fed by AudioWorklet postMessage).
 * If migrated to SharedArrayBuffer for lock-free worklet communication,
 * writePos must be read/written via Atomics.load / Atomics.store and
 * a memory barrier must separate data writes from the position update.
 */
export class RingBuffer {
  private buffers: Float32Array[];
  private length: number;
  private writePos: number;
  readonly channels: number;

  constructor(channels: number, lengthSamples: number) {
    this.channels = channels;
    this.length = lengthSamples;
    this.writePos = 0;
    this.buffers = [];
    for (let c = 0; c < channels; c++) {
      this.buffers.push(new Float32Array(lengthSamples));
    }
  }

  get size(): number {
    return this.length;
  }

  get position(): number {
    return this.writePos;
  }

  push(channelData: Float32Array[]): void {
    const n = channelData[0]?.length ?? 0;
    if (n === 0) return;
    const chCount = Math.min(channelData.length, this.channels);
    for (let c = 0; c < chCount; c++) {
      const buf = this.buffers[c];
      const data = channelData[c];
      const first = Math.min(n, this.length - this.writePos);
      buf.set(data.subarray(0, first), this.writePos);
      if (first < n) buf.set(data.subarray(first), 0);
    }
    this.writePos = (this.writePos + n) % this.length;
  }

  pushMono(samples: Float32Array): void {
    this.push([samples]);
  }

  read(endOffset: number, length: number, channel = 0): Float32Array {
    const out = new Float32Array(length);
    const buf = this.buffers[channel];
    let start = (endOffset - length) % this.length;
    if (start < 0) start += this.length;
    const first = Math.min(length, this.length - start);
    out.set(buf.subarray(start, start + first));
    if (first < length) out.set(buf.subarray(0, length - first), first);
    return out;
  }

  readMulti(endOffset: number, length: number): Float32Array[] {
    const result: Float32Array[] = [];
    for (let c = 0; c < this.channels; c++) {
      result.push(this.read(endOffset, length, c));
    }
    return result;
  }

  clear(): void {
    for (const buf of this.buffers) {
      buf.fill(0);
    }
    this.writePos = 0;
  }
}
