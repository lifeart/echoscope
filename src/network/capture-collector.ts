import { peerManager } from './peer-manager.js';
import { decodeAudioChunk } from './codec.js';
import type { CaptureRequest, CaptureResponse } from '../types.js';

interface PendingCapture {
  pingId: number;
  expectedCount: number;
  responses: CaptureResponse[];
  resolve: (responses: CaptureResponse[]) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<number, PendingCapture>();

export function broadcastCaptureRequest(
  pingId: number,
  angleDeg: number,
  listenMs: number,
  probeType: string,
): void {
  const connectedPeers = peerManager.getConnectedPeerIds();
  if (connectedPeers.length === 0) return;

  const request: CaptureRequest = { pingId, angleDeg, listenMs, probeType };
  const encoded = new TextEncoder().encode(JSON.stringify(request));
  const buf = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buf).set(encoded);
  peerManager.sendCaptureRequest(buf);
}

export function waitForRemoteCaptures(
  pingId: number,
  timeoutMs: number,
): Promise<CaptureResponse[]> {
  const connectedPeers = peerManager.getConnectedPeerIds();
  if (connectedPeers.length === 0) return Promise.resolve([]);

  return new Promise<CaptureResponse[]>((resolve) => {
    const timer = setTimeout(() => {
      const entry = pending.get(pingId);
      if (entry) {
        pending.delete(pingId);
        resolve(entry.responses);
      } else {
        resolve([]);
      }
    }, timeoutMs);

    pending.set(pingId, {
      pingId,
      expectedCount: connectedPeers.length,
      responses: [],
      resolve,
      timer,
    });
  });
}

export function setupCaptureResponseHandler(): void {
  peerManager.onCaptureResponse((peerId: string, data: ArrayBuffer) => {
    if (data.byteLength < 4) return;
    const view = new DataView(data);
    const pingId = view.getUint32(0);
    const audioPayload = data.slice(4);
    const decoded = decodeAudioChunk(audioPayload);
    if (!decoded) return;
    const clockOffset = peerManager.getPeerClockOffset(peerId);
    onCaptureResponse({
      pingId,
      peerId,
      timestamp: decoded.timestamp - clockOffset,
      sampleRate: decoded.sampleRate,
      channels: decoded.channels,
    });
  });
}

function onCaptureResponse(response: CaptureResponse): void {
  const entry = pending.get(response.pingId);
  if (!entry) return;

  entry.responses.push(response);

  if (entry.responses.length >= entry.expectedCount) {
    clearTimeout(entry.timer);
    pending.delete(response.pingId);
    entry.resolve(entry.responses);
  }
}
