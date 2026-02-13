import { peerManager } from './peer-manager.js';
import { encodeAudioChunk } from './codec.js';
import { store } from '../core/store.js';
import { getSampleRate } from '../audio/engine.js';
import type { CaptureRequest } from '../types.js';

/**
 * Handles incoming capture requests on the remote (non-orchestrator) device.
 * Reads from the local audio ring buffer and sends back a capture response.
 */
export function setupRemoteCaptureHandler(): void {
  peerManager.onCaptureRequest((_peerId: string, data: ArrayBuffer) => {
    let request: CaptureRequest;
    try {
      const json = new TextDecoder().decode(data);
      request = JSON.parse(json);
    } catch {
      return; // Malformed capture request
    }
    handleCaptureRequest(_peerId, request);
  });
}

function handleCaptureRequest(peerId: string, request: CaptureRequest): void {
  const state = store.get();
  const sampleRate = getSampleRate();

  // Get recent audio from the last received chunks
  // If we have local audio data available, encode and send it back
  const probeConfig = state.config.probe;
  const timestamp = performance.now() / 1000;

  // For now, we send back whatever local audio we have captured
  // In a full implementation, this would read from a local ring buffer
  const chunks = peerManager.getAllRemoteChunks();
  const localChunk = chunks.length > 0 ? chunks[chunks.length - 1] : null;

  if (localChunk) {
    // Build response: pingId prefix (4 bytes) + encoded audio
    const encoded = encodeAudioChunk(timestamp, sampleRate, localChunk.channels, probeConfig);
    const response = new ArrayBuffer(4 + encoded.byteLength);
    const view = new DataView(response);
    view.setUint32(0, request.pingId);
    new Uint8Array(response).set(new Uint8Array(encoded), 4);
    peerManager.sendCaptureResponse(peerId, response);
  }
}
