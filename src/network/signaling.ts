/**
 * Manual signaling for WebRTC: generates offer/answer as copyable text.
 * No server needed - users exchange via QR code, clipboard, or messaging.
 */

export function encodeSignal(description: RTCSessionDescriptionInit): string {
  return btoa(JSON.stringify(description));
}

export function decodeSignal(encoded: string): RTCSessionDescriptionInit {
  return JSON.parse(atob(encoded));
}
