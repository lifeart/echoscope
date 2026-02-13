/**
 * Compress/decompress SDP signal text for QR transport.
 * Uses stable base64url transport with SDP candidate compaction for signaling payloads.
 * Stream-based compression path exists but is disabled for runtime reliability.
 */

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64ToBase64Url(base64: string): string {
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlToBase64(base64url: string): string {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) base64 += '=';
  return base64;
}

function fromBase64Url(str: string): Uint8Array {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  // Restore padding
  while (base64.length % 4 !== 0) base64 += '=';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function isLikelyBase64Signal(text: string): boolean {
  return parseBase64Signal(text) !== null;
}

type DecodedSignal = { type: string; sdp: string };

function parseBase64Signal(text: string): DecodedSignal | null {
  const trimmed = text.trim();
  if (!trimmed || !/^[A-Za-z0-9+/=]+$/.test(trimmed)) return null;

  let json = '';
  try {
    json = atob(trimmed);
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (typeof parsed.type !== 'string' || typeof parsed.sdp !== 'string') return null;
    return { type: parsed.type, sdp: parsed.sdp };
  } catch {
    return null;
  }
}

function encodeBase64Signal(signal: DecodedSignal): string {
  return btoa(JSON.stringify(signal));
}

function compactSdpForQr(sdp: string): string {
  const lines = sdp.split(/\r?\n/).filter(Boolean);
  const nonCandidates: string[] = [];
  const candidates: string[] = [];

  for (const line of lines) {
    if (line.startsWith('a=candidate:')) {
      candidates.push(line);
    } else {
      nonCandidates.push(line);
    }
  }

  if (candidates.length === 0) {
    return sdp;
  }

  const selected: string[] = [];
  let haveUdpHost = false;
  let haveUdpSrflx = false;
  let firstUdpFallback: string | null = null;

  for (const line of candidates) {
    const match = /^a=candidate:[^\s]+\s+\d+\s+(\w+)\s+\d+\s+([^\s]+)\s+\d+\s+typ\s+(\w+)/i.exec(line);
    if (!match) continue;

    const transport = match[1].toLowerCase();
    const address = match[2];
    const candType = match[3].toLowerCase();
    const isIpv6 = address.includes(':');
    if (transport !== 'udp' || isIpv6) continue;

    if (!firstUdpFallback) firstUdpFallback = line;

    if (candType === 'host' && !haveUdpHost) {
      selected.push(line);
      haveUdpHost = true;
      continue;
    }

    if (candType === 'srflx' && !haveUdpSrflx) {
      selected.push(line);
      haveUdpSrflx = true;
      continue;
    }
  }

  if (selected.length === 0 && firstUdpFallback) {
    selected.push(firstUdpFallback);
  }

  if (selected.length === 0) {
    selected.push(candidates[0]);
  }

  const compactLines = [...nonCandidates, ...selected];
  return compactLines.join('\r\n') + '\r\n';
}

function compactBase64SignalForQr(signalText: string): string {
  const parsed = parseBase64Signal(signalText);
  if (!parsed) return signalText;
  const compact = compactSdpForQr(parsed.sdp);
  if (compact.length >= parsed.sdp.length) return signalText;
  return encodeBase64Signal({ type: parsed.type, sdp: compact });
}

function encodeFallbackWithoutStream(signalText: string): string {
  const isBase64Signal = isLikelyBase64Signal(signalText);
  const preparedSignal = isBase64Signal ? compactBase64SignalForQr(signalText) : signalText;
  if (isBase64Signal) {
    return `b.${base64ToBase64Url(preparedSignal)}`;
  }
  return toBase64Url(new TextEncoder().encode(preparedSignal));
}

const hasCompressionApi = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
let resolvedCompressionFormat: string | null | undefined;
const ENABLE_STREAM_COMPRESSION = false;

function resolveCompressionFormat(): string | null {
  if (resolvedCompressionFormat !== undefined) return resolvedCompressionFormat;
  if (!ENABLE_STREAM_COMPRESSION) {
    resolvedCompressionFormat = null;
    return null;
  }
  if (!hasCompressionApi) {
    resolvedCompressionFormat = null;
    return null;
  }

  const candidates = ['deflate-raw', 'deflate'];
  for (const format of candidates) {
    try {
      new CompressionStream(format as CompressionFormat);
      new DecompressionStream(format as CompressionFormat);
      resolvedCompressionFormat = format;
      return format;
    } catch {
      // Try next format
    }
  }

  resolvedCompressionFormat = null;
  return null;
}

export async function compressSignal(signalText: string): Promise<string> {
  const format = resolveCompressionFormat();
  if (!format) {
    return encodeFallbackWithoutStream(signalText);
  }

  try {
    const preparedSignal = isLikelyBase64Signal(signalText) ? compactBase64SignalForQr(signalText) : signalText;
    const encoded = new TextEncoder().encode(preparedSignal);

    const cs = new CompressionStream(format as CompressionFormat);
    const writer = cs.writable.getWriter();
    await writer.write(encoded);
    await writer.close();

    const reader = cs.readable.getReader();
    const chunks: Uint8Array[] = [];
    let totalLen = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLen += value.length;
    }

    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return toBase64Url(result);
  } catch {
    // Browser exposes CompressionStream but runtime path failed.
    // Disable stream mode for subsequent calls and use robust fallback.
    resolvedCompressionFormat = null;
    return encodeFallbackWithoutStream(signalText);
  }
}

export async function decompressSignal(compressed: string): Promise<string> {
  if (compressed.startsWith('b.')) {
    return base64UrlToBase64(compressed.slice(2));
  }

  // Raw base64 signal payload (uncompressed fallback path)
  if (/[+/=]/.test(compressed) && isLikelyBase64Signal(compressed)) {
    return compressed;
  }

  const bytes = fromBase64Url(compressed);
  const format = resolveCompressionFormat();
  if (!format) {
    return new TextDecoder().decode(bytes);
  }

  try {
    const ds = new DecompressionStream(format as CompressionFormat);
    const writer = ds.writable.getWriter();
    const strictBytes = new Uint8Array(bytes.byteLength);
    strictBytes.set(bytes);
    await writer.write(strictBytes);
    await writer.close();

    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let totalLen = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLen += value.length;
    }

    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return new TextDecoder().decode(result);
  } catch {
    // Legacy non-compressed payload that was base64url(text)
    return new TextDecoder().decode(bytes);
  }
}
