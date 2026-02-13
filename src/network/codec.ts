import type { ProbeConfig } from '../types.js';

// Binary protocol:
// [magic: 4 bytes "ECHO"][version: uint8][timestamp: float64][sampleRate: uint32]
// [channelCount: uint8][samplesPerChannel: uint32][probeType: uint8]
// [...float32 samples for each channel]

const MAGIC = 0x4543484F; // "ECHO"
const CODEC_VERSION = 1;
const HEADER_SIZE = 4 + 1 + 8 + 4 + 1 + 4 + 1; // 23 bytes

const PROBE_TYPE_MAP: Record<string, number> = { chirp: 0, mls: 1, golay: 2, multiplex: 3 };
const PROBE_TYPES = ['chirp', 'mls', 'golay', 'multiplex'];

export function encodeAudioChunk(
  timestamp: number,
  sampleRate: number,
  channels: Float32Array[],
  probeConfig: ProbeConfig,
): ArrayBuffer {
  const channelCount = channels.length;
  const samplesPerChannel = channels[0]?.length ?? 0;
  const dataSize = channelCount * samplesPerChannel * 4;
  const buf = new ArrayBuffer(HEADER_SIZE + dataSize);
  const view = new DataView(buf);
  let offset = 0;

  view.setUint32(offset, MAGIC); offset += 4;
  view.setUint8(offset, CODEC_VERSION); offset += 1;
  view.setFloat64(offset, timestamp); offset += 8;
  view.setUint32(offset, sampleRate); offset += 4;
  view.setUint8(offset, channelCount); offset += 1;
  view.setUint32(offset, samplesPerChannel); offset += 4;
  view.setUint8(offset, PROBE_TYPE_MAP[probeConfig.type] ?? 0); offset += 1;

  for (let c = 0; c < channelCount; c++) {
    const ch = channels[c];
    for (let i = 0; i < samplesPerChannel; i++) {
      view.setFloat32(offset, ch[i]); offset += 4;
    }
  }

  return buf;
}

export function decodeAudioChunk(buf: ArrayBuffer): {
  timestamp: number;
  sampleRate: number;
  channels: Float32Array[];
  probeType: string;
} | null {
  const view = new DataView(buf);
  if (buf.byteLength < HEADER_SIZE) return null;

  let offset = 0;
  const magic = view.getUint32(offset); offset += 4;
  if (magic !== MAGIC) return null;

  const version = view.getUint8(offset); offset += 1;
  if (version !== CODEC_VERSION) return null;

  const timestamp = view.getFloat64(offset); offset += 8;
  const sampleRate = view.getUint32(offset); offset += 4;
  const channelCount = view.getUint8(offset); offset += 1;
  const samplesPerChannel = view.getUint32(offset); offset += 4;
  const probeTypeByte = view.getUint8(offset); offset += 1;

  // Sanity limits to prevent excessive allocation
  if (channelCount === 0 || channelCount > 16) return null;
  if (samplesPerChannel > 1_000_000) return null;

  // Validate buffer has enough data for all samples
  const expectedSize = HEADER_SIZE + channelCount * samplesPerChannel * 4;
  if (buf.byteLength < expectedSize) return null;

  const probeType = PROBE_TYPES[probeTypeByte] ?? 'chirp';

  const channels: Float32Array[] = [];
  for (let c = 0; c < channelCount; c++) {
    const ch = new Float32Array(samplesPerChannel);
    for (let i = 0; i < samplesPerChannel; i++) {
      ch[i] = view.getFloat32(offset); offset += 4;
    }
    channels.push(ch);
  }

  return { timestamp, sampleRate, channels, probeType };
}
