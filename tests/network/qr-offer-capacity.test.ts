import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';

function buildLargeOfferSignal(): string {
  const candidates = [
    'a=candidate:1 1 udp 2122260223 10.242.252.175 64343 typ host generation 0 network-id 3',
    'a=candidate:2 1 udp 2122194687 172.29.252.175 65423 typ host generation 0 network-id 4',
    'a=candidate:3 1 udp 2122063615 192.168.9.244 49898 typ host generation 0 network-id 1 network-cost 10',
    'a=candidate:4 1 udp 2122134271 fd7b:d21a:97d8:0:1061:1a1c:2bb1:4d9b 52090 typ host generation 0 network-id 2 network-cost 10',
    'a=candidate:5 1 tcp 1518280447 10.242.252.175 9 typ host tcptype active generation 0 network-id 3',
    'a=candidate:6 1 tcp 1518214911 172.29.252.175 9 typ host tcptype active generation 0 network-id 4',
    'a=candidate:7 1 tcp 1518083839 192.168.9.244 9 typ host tcptype active generation 0 network-id 1 network-cost 10',
    'a=candidate:8 1 tcp 1518154495 fd7b:d21a:97d8:0:1061:1a1c:2bb1:4d9b 9 typ host tcptype active generation 0 network-id 2 network-cost 10',
    'a=candidate:9 1 udp 1685855999 212.58.120.193 2285 typ srflx raddr 192.168.9.244 rport 49898 generation 0 network-id 1 network-cost 10',
  ];

  const sdpLines = [
    'v=0',
    'o=- 7785823618261780460 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=extmap-allow-mixed',
    'a=msid-semantic: WMS',
    'm=application 2285 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 212.58.120.193',
    ...candidates,
    'a=ice-ufrag:y57g',
    'a=ice-pwd:NpbbRPhD20H1Zsw7YOkuMhz5',
    'a=ice-options:trickle',
    'a=fingerprint:sha-256 1E:A1:5B:5E:15:C8:89:00:65:8C:DB:B7:F7:48:73:AD:F9:F2:09:3C:3B:40:8D:63:1A:60:AB:81:62:B5:18:9D',
    'a=setup:actpass',
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
  ];

  const sdp = `${sdpLines.join('\r\n')}\r\n`;
  return btoa(JSON.stringify({ type: 'offer', sdp }));
}

function buildOfferUrl(payload: string): string {
  const params = new URLSearchParams();
  params.set('o', payload);
  return `https://192.168.1.10:5173/?${params.toString()}`;
}

describe('qr offer capacity', () => {
  it('fits into QR for large offer payload', async () => {
    const signal = buildLargeOfferSignal();
    const mod = await import('../../src/network/signal-compress.js');
    const payload = await mod.compressSignal(signal);
    const url = buildOfferUrl(payload);

    expect(() => QRCode.create(url, { errorCorrectionLevel: 'L' })).not.toThrow();
  });
});
