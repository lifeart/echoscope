import { compressSignal, decompressSignal } from '../../src/network/signal-compress.js';
import { decodeSignal } from '../../src/network/signaling.js';

describe('signal-compress', () => {
  it('round-trips a typical SDP string', async () => {
    const sdp = JSON.stringify({
      type: 'offer',
      sdp: 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n',
    });
    const compressed = await compressSignal(sdp);
    const restored = await decompressSignal(compressed);
    expect(restored).toBe(sdp);
  });

  it('compressed output contains only base64url chars', async () => {
    const text = 'Hello, world! This is a test payload for QR transport.';
    const compressed = await compressSignal(text);
    expect(compressed).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('compressed output is shorter than plain base64 for large input', async () => {
    // Create a large repetitive SDP-like string (deflate loves repetition)
    const text = 'a=candidate:1234567890 1 udp 2122260223 192.168.1.1 12345 typ host\r\n'.repeat(20);
    const compressed = await compressSignal(text);
    const plainBase64Len = btoa(text).length;
    expect(compressed.length).toBeLessThan(plainBase64Len);
  });

  it('handles empty string', async () => {
    const compressed = await compressSignal('');
    const restored = await decompressSignal(compressed);
    expect(restored).toBe('');
  });

  it('handles unicode content', async () => {
    const text = 'test: \u00e9\u00e8\u00ea \u2603 \ud83d\ude00';
    const compressed = await compressSignal(text);
    const restored = await decompressSignal(compressed);
    expect(restored).toBe(text);
  });

  it('accepts raw base64 signaling payload in decompress path', async () => {
    const signal = btoa(JSON.stringify({
      type: 'offer',
      sdp: 'v=0\r\na=ice-ufrag:abc\r\na=ice-pwd:def\r\n',
    }));
    const restored = await decompressSignal(signal);
    expect(restored).toBe(signal);
  });

  it('compressed signaling payload is decodable by signaling parser', async () => {
    const signal = btoa(JSON.stringify({
      type: 'answer',
      sdp: 'v=0\r\na=ice-ufrag:xyz\r\na=ice-pwd:qwe\r\n',
    }));
    const compressed = await compressSignal(signal);
    const restored = await decompressSignal(compressed);
    const decoded = decodeSignal(restored);
    expect(decoded.type).toBe('answer');
  });

  it('supports base64url raw signaling payload fallback', async () => {
    const signal = btoa(JSON.stringify({
      type: 'offer',
      sdp: 'v=0\r\na=ice-ufrag:abc\r\na=ice-pwd:def\r\n',
    }));

    const compressed = await compressSignal(signal);
    expect(compressed.startsWith('b.')).toBe(true);
    expect(compressed.slice(2)).toMatch(/^[A-Za-z0-9_-]+$/);

    const restored = await decompressSignal(compressed);
    const decoded = decodeSignal(restored);
    expect(decoded.type).toBe('offer');
  });

});
