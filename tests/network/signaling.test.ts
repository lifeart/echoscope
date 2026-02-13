import { encodeSignal, decodeSignal } from '../../src/network/signaling.js';

describe('signaling', () => {
  it('round-trips a valid signal', () => {
    const desc: RTCSessionDescriptionInit = { type: 'offer', sdp: 'v=0\r\n...' };
    const encoded = encodeSignal(desc);
    const decoded = decodeSignal(encoded);
    expect(decoded.type).toBe('offer');
    expect(decoded.sdp).toBe('v=0\r\n...');
  });

  it('rejects empty string', () => {
    expect(() => decodeSignal('')).toThrow('Empty signal string');
  });

  it('rejects whitespace-only string', () => {
    expect(() => decodeSignal('   ')).toThrow('Empty signal string');
  });

  it('rejects invalid base64', () => {
    expect(() => decodeSignal('not!valid!base64')).toThrow('Invalid base64');
  });

  it('rejects valid base64 but invalid JSON', () => {
    const encoded = btoa('not json');
    expect(() => decodeSignal(encoded)).toThrow('Invalid JSON');
  });

  it('rejects JSON without type field', () => {
    const encoded = btoa(JSON.stringify({ sdp: 'v=0' }));
    expect(() => decodeSignal(encoded)).toThrow('must have "type" and "sdp"');
  });

  it('rejects JSON without sdp field', () => {
    const encoded = btoa(JSON.stringify({ type: 'offer' }));
    expect(() => decodeSignal(encoded)).toThrow('must have "type" and "sdp"');
  });

  it('rejects JSON with non-string type', () => {
    const encoded = btoa(JSON.stringify({ type: 123, sdp: 'v=0' }));
    expect(() => decodeSignal(encoded)).toThrow('must have "type" and "sdp"');
  });

  it('trims whitespace from input', () => {
    const desc: RTCSessionDescriptionInit = { type: 'answer', sdp: 'v=0' };
    const encoded = '  ' + encodeSignal(desc) + '  ';
    const decoded = decodeSignal(encoded);
    expect(decoded.type).toBe('answer');
  });
});
