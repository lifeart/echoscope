import { peerManager } from './peer-manager.js';
import { encodeAudioChunk } from './codec.js';
import { getRingBuffer, computeListenSamples, getSampleRate } from '../audio/engine.js';
import { store } from '../core/store.js';
import { sleep } from '../utils.js';
import type { CaptureRequest } from '../types.js';

const CAPTURE_MARGIN_MS = 100;

export function setupRemoteCaptureHandler(): void {
  peerManager.onCaptureRequest((_peerId: string, data: ArrayBuffer) => {
    let request: CaptureRequest;
    try {
      const json = new TextDecoder().decode(data);
      request = JSON.parse(json);
    } catch { return; }
    handleCaptureRequest(_peerId, request);
  });
}

async function handleCaptureRequest(peerId: string, request: CaptureRequest): Promise<void> {
  const ring = getRingBuffer();
  if (!ring) return;
  const sampleRate = getSampleRate();

  // Wait for orchestrator's probe + echo window to elapse
  await sleep(request.listenMs + CAPTURE_MARGIN_MS);

  // Read local mic audio from ring buffer with pre-roll and post-roll margin:
  // [request-arrival - CAPTURE_MARGIN_MS, request-arrival + listenMs + CAPTURE_MARGIN_MS].
  // This keeps early direct-path energy even when signaling latency is non-zero.
  const totalMs = request.listenMs + 2 * CAPTURE_MARGIN_MS;
  const listenSamples = computeListenSamples(totalMs, 0, sampleRate);
  const end = ring.position;
  const channels = ring.readMulti(end, listenSamples);

  // Timestamp = ring buffer read time (remote clock, corrected by orchestrator)
  const timestamp = performance.now() / 1000;

  const probeConfig = store.get().config.probe;
  const encoded = encodeAudioChunk(timestamp, sampleRate, channels, probeConfig);
  const response = new ArrayBuffer(4 + encoded.byteLength);
  new DataView(response).setUint32(0, request.pingId);
  new Uint8Array(response).set(new Uint8Array(encoded), 4);
  peerManager.sendCaptureResponse(peerId, response);
}
