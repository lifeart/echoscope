import { RingBuffer } from '../../src/audio/ring-buffer.js';

describe('RingBuffer', () => {
  it('stores and reads mono samples', () => {
    const rb = new RingBuffer(1, 10);
    rb.pushMono(new Float32Array([1, 2, 3, 4, 5]));
    const out = rb.read(rb.position, 5);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });

  it('wraps around correctly', () => {
    const rb = new RingBuffer(1, 4);
    rb.pushMono(new Float32Array([1, 2, 3, 4]));
    rb.pushMono(new Float32Array([5, 6]));
    // Buffer should now be [5, 6, 3, 4] with write at 2
    const out = rb.read(rb.position, 4);
    expect(Array.from(out)).toEqual([3, 4, 5, 6]);
  });

  it('supports multichannel', () => {
    const rb = new RingBuffer(2, 8);
    rb.push([new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])]);
    const ch0 = rb.read(rb.position, 3, 0);
    const ch1 = rb.read(rb.position, 3, 1);
    expect(Array.from(ch0)).toEqual([1, 2, 3]);
    expect(Array.from(ch1)).toEqual([4, 5, 6]);
  });

  it('clears buffer', () => {
    const rb = new RingBuffer(1, 4);
    rb.pushMono(new Float32Array([1, 2, 3, 4]));
    rb.clear();
    expect(rb.position).toBe(0);
    const out = rb.read(0, 4);
    expect(out.every(v => v === 0)).toBe(true);
  });
});
