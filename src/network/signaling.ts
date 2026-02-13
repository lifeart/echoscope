/**
 * Manual signaling for WebRTC: generates offer/answer as copyable text.
 * No server needed - users exchange via QR code, clipboard, or messaging.
 */

export function encodeSignal(description: RTCSessionDescriptionInit): string {
  return btoa(JSON.stringify(description));
}

export function decodeSignal(encoded: string): RTCSessionDescriptionInit {
  const trimmed = encoded.trim();
  if (!trimmed) throw new Error('Empty signal string');

  // Validate base64 characters
  if (!/^[A-Za-z0-9+/=]+$/.test(trimmed)) {
    throw new Error('Invalid base64 encoding');
  }

  let json: string;
  try {
    json = atob(trimmed);
  } catch {
    throw new Error('Invalid base64 encoding');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON in signal');
  }

  if (
    typeof parsed !== 'object' || parsed === null ||
    !('type' in parsed) || !('sdp' in parsed) ||
    typeof (parsed as Record<string, unknown>).type !== 'string' ||
    typeof (parsed as Record<string, unknown>).sdp !== 'string'
  ) {
    throw new Error('Signal must have "type" and "sdp" string fields');
  }

  return parsed as RTCSessionDescriptionInit;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fallback */ }

  // Fallback for insecure contexts
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export async function readFromClipboard(): Promise<string> {
  if (navigator.clipboard?.readText) {
    return navigator.clipboard.readText();
  }
  throw new Error('Clipboard read not available');
}
