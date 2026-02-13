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

  it('includes version byte in header', () => {
    const channels = [new Float32Array([1])];
    const config = { type: 'chirp' as const, params: { f1: 2000, f2: 9000, durationMs: 7 } };
    const encoded = encodeAudioChunk(0, 48000, channels, config);
    const view = new DataView(encoded);
    // Version byte is at offset 4 (after magic)
    expect(view.getUint8(4)).toBe(1);
  });

  it('rejects wrong version', () => {
    const channels = [new Float32Array([1])];
    const config = { type: 'chirp' as const, params: { f1: 2000, f2: 9000, durationMs: 7 } };
    const encoded = encodeAudioChunk(0, 48000, channels, config);
    // Corrupt version byte
    const view = new DataView(encoded);
    view.setUint8(4, 99);
    expect(decodeAudioChunk(encoded)).toBeNull();
  });

  it('rejects buffer with truncated sample data', () => {
    const channels = [new Float32Array([1, 2, 3, 4, 5])];
    const config = { type: 'chirp' as const, params: { f1: 2000, f2: 9000, durationMs: 7 } };
    const encoded = encodeAudioChunk(0, 48000, channels, config);
    // Truncate to just the header (no samples)
    const truncated = encoded.slice(0, 23);
    expect(decodeAudioChunk(truncated)).toBeNull();
  });

  it('encodes and decodes multiplex probe type', () => {
    const channels = [new Float32Array([1])];
    const config = {
      type: 'multiplex' as const,
      params: {
        carrierCount: 4, fStart: 2000, fEnd: 8000, symbolMs: 8,
        guardHz: 100, minSpacingHz: 500, calibrationCandidates: 8,
        fusion: 'snrWeighted' as const,
      },
    };
    const encoded = encodeAudioChunk(0, 48000, channels, config);
    const decoded = decodeAudioChunk(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.probeType).toBe('multiplex');
  });

  it('has header size of 23 bytes', () => {
    const channels = [new Float32Array(0)];
    const config = { type: 'chirp' as const, params: { f1: 2000, f2: 9000, durationMs: 7 } };
    const encoded = encodeAudioChunk(0, 48000, channels, config);
    // Header only, no sample data
    expect(encoded.byteLength).toBe(23);
  });

  it('round-trips NaN and Infinity values', () => {
    const channels = [new Float32Array([NaN, Infinity, -Infinity, 0])];
    const config = { type: 'chirp' as const, params: { f1: 2000, f2: 9000, durationMs: 7 } };
    const encoded = encodeAudioChunk(0, 48000, channels, config);
    const decoded = decodeAudioChunk(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.channels[0][0]).toBeNaN();
    expect(decoded!.channels[0][1]).toBe(Infinity);
    expect(decoded!.channels[0][2]).toBe(-Infinity);
    expect(decoded!.channels[0][3]).toBe(0);
  });

  it('round-trips all four probe types', () => {
    const channels = [new Float32Array([1])];
    const configs = [
      { type: 'chirp' as const, params: { f1: 2000, f2: 9000, durationMs: 7 } },
      { type: 'mls' as const, params: { order: 10, chipRate: 48000 } },
      { type: 'golay' as const, params: { order: 10, chipRate: 48000, gapMs: 5 } },
      {
        type: 'multiplex' as const,
        params: {
          carrierCount: 4, fStart: 2000, fEnd: 8000, symbolMs: 8,
          guardHz: 100, minSpacingHz: 500, calibrationCandidates: 8,
          fusion: 'snrWeighted' as const,
        },
      },
    ];
    const expectedTypes = ['chirp', 'mls', 'golay', 'multiplex'];

    for (let i = 0; i < configs.length; i++) {
      const encoded = encodeAudioChunk(0, 48000, channels, configs[i]);
      const decoded = decodeAudioChunk(encoded);
      expect(decoded).not.toBeNull();
      expect(decoded!.probeType).toBe(expectedTypes[i]);
    }
  });

  it('falls back to chirp for unknown probe type', () => {
    const channels = [new Float32Array([1])];
    // Force an unknown type by casting
    const config = { type: 'unknown' as any, params: {} as any };
    const encoded = encodeAudioChunk(0, 48000, channels, config);
    const decoded = decodeAudioChunk(encoded);
    expect(decoded).not.toBeNull();
    // Unknown type maps to 0 in encoder (PROBE_TYPE_MAP fallback), decoded as 'chirp'
    expect(decoded!.probeType).toBe('chirp');
  });

  it('round-trips realistic buffer size (4800 samples x 2 channels at 48kHz)', () => {
    const ch0 = new Float32Array(4800);
    const ch1 = new Float32Array(4800);
    for (let i = 0; i < 4800; i++) {
      ch0[i] = Math.sin(2 * Math.PI * 440 * i / 48000);
      ch1[i] = Math.cos(2 * Math.PI * 440 * i / 48000);
    }
    const channels = [ch0, ch1];
    const config = { type: 'chirp' as const, params: { f1: 2000, f2: 9000, durationMs: 7 } };
    const encoded = encodeAudioChunk(1000.0, 48000, channels, config);
    const decoded = decodeAudioChunk(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.sampleRate).toBe(48000);
    expect(decoded!.channels.length).toBe(2);
    expect(decoded!.channels[0].length).toBe(4800);
    expect(decoded!.channels[1].length).toBe(4800);
    // Verify fidelity: float32 encode/decode should be exact
    for (let i = 0; i < 4800; i++) {
      expect(decoded!.channels[0][i]).toBe(ch0[i]);
      expect(decoded!.channels[1][i]).toBe(ch1[i]);
    }
  });

  it('returns null when decoding zero channels', () => {
    const channels: Float32Array[] = [];
    const config = { type: 'chirp' as const, params: { f1: 2000, f2: 9000, durationMs: 7 } };
    const encoded = encodeAudioChunk(0, 48000, channels, config);
    const decoded = decodeAudioChunk(encoded);
    // channelCount === 0 triggers sanity check, returns null
    expect(decoded).toBeNull();
  });

  it('returns null for channelCount > 16 (sanity limit)', () => {
    // Manually construct a buffer with channelCount=17
    const HEADER_SIZE = 23;
    const buf = new ArrayBuffer(HEADER_SIZE);
    const view = new DataView(buf);
    let offset = 0;
    view.setUint32(offset, 0x4543484F); offset += 4;  // magic "ECHO"
    view.setUint8(offset, 1); offset += 1;              // version
    view.setFloat64(offset, 0); offset += 8;             // timestamp
    view.setUint32(offset, 48000); offset += 4;          // sampleRate
    view.setUint8(offset, 17); offset += 1;              // channelCount = 17 (exceeds limit)
    view.setUint32(offset, 0); offset += 4;              // samplesPerChannel
    view.setUint8(offset, 0); offset += 1;               // probeType

    expect(decodeAudioChunk(buf)).toBeNull();
  });

  it('returns null for samplesPerChannel > 1_000_000 (sanity limit)', () => {
    // Manually construct a buffer with samplesPerChannel=1_000_001
    const HEADER_SIZE = 23;
    const buf = new ArrayBuffer(HEADER_SIZE);
    const view = new DataView(buf);
    let offset = 0;
    view.setUint32(offset, 0x4543484F); offset += 4;  // magic "ECHO"
    view.setUint8(offset, 1); offset += 1;              // version
    view.setFloat64(offset, 0); offset += 8;             // timestamp
    view.setUint32(offset, 48000); offset += 4;          // sampleRate
    view.setUint8(offset, 1); offset += 1;               // channelCount = 1
    view.setUint32(offset, 1_000_001); offset += 4;      // samplesPerChannel (exceeds limit)
    view.setUint8(offset, 0); offset += 1;               // probeType

    expect(decodeAudioChunk(buf)).toBeNull();
  });
});
