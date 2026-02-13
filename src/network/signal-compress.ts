/**
 * Compress/decompress SDP signal text for QR transport.
 * Uses CompressionStream (prefers deflate-raw, falls back to deflate)
 * + base64url encoding.
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

const hasCompressionApi = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
let resolvedCompressionFormat: string | null | undefined;

function resolveCompressionFormat(): string | null {
  if (resolvedCompressionFormat !== undefined) return resolvedCompressionFormat;
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
  const encoded = new TextEncoder().encode(signalText);
  const format = resolveCompressionFormat();
  if (!format) {
    return toBase64Url(encoded);
  }

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
}

export async function decompressSignal(compressed: string): Promise<string> {
  const bytes = fromBase64Url(compressed);
  const format = resolveCompressionFormat();
  if (!format) {
    return new TextDecoder().decode(bytes);
  }

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
}
