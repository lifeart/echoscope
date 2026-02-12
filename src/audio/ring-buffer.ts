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
      for (let i = 0; i < n; i++) {
        buf[(this.writePos + i) % this.length] = data[i];
      }
    }
    this.writePos = (this.writePos + n) % this.length;
  }

  pushMono(samples: Float32Array): void {
    this.push([samples]);
  }

  read(endOffset: number, length: number, channel = 0): Float32Array {
    const out = new Float32Array(length);
    const buf = this.buffers[channel];
    let idx = (endOffset - length) % this.length;
    if (idx < 0) idx += this.length;
    for (let i = 0; i < length; i++) {
      out[i] = buf[idx];
      idx = (idx + 1) % this.length;
    }
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
