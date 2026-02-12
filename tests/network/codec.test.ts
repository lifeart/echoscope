import { encodeAudioChunk, decodeAudioChunk } from '../../src/network/codec.js';

describe('codec', () => {
  it('round-trips audio chunk', () => {
    const channels = [new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])];
    const config = { type: 'chirp' as const, params: { f1: 2000, f2: 9000, durationMs: 7 } };

    const encoded = encodeAudioChunk(1234.5, 48000, channels, config);
    const decoded = decodeAudioChunk(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.timestamp).toBe(1234.5);
    expect(decoded!.sampleRate).toBe(48000);
    expect(decoded!.channels.length).toBe(2);
    expect(Array.from(decoded!.channels[0])).toEqual([1, 2, 3]);
    expect(Array.from(decoded!.channels[1])).toEqual([4, 5, 6]);
  });

  it('rejects invalid magic', () => {
    const buf = new ArrayBuffer(32);
    const view = new DataView(buf);
    view.setUint32(0, 0xDEADBEEF);
    expect(decodeAudioChunk(buf)).toBeNull();
  });

  it('rejects too-short buffer', () => {
    expect(decodeAudioChunk(new ArrayBuffer(4))).toBeNull();
  });
});
