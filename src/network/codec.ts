import type { ProbeConfig } from '../types.js';

// Binary protocol:
// [magic: 4 bytes "ECHO"][timestamp: float64][sampleRate: uint32]
// [channelCount: uint8][samplesPerChannel: uint32][probeType: uint8]
// [...float32 samples for each channel]

const MAGIC = 0x4543484F; // "ECHO"

export function encodeAudioChunk(
  timestamp: number,
  sampleRate: number,
  channels: Float32Array[],
  probeConfig: ProbeConfig,
): ArrayBuffer {
  const channelCount = channels.length;
  const samplesPerChannel = channels[0]?.length ?? 0;
  const headerSize = 4 + 8 + 4 + 1 + 4 + 1; // magic + ts + sr + chCount + sampCount + probeType
  const dataSize = channelCount * samplesPerChannel * 4;
  const buf = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buf);
  let offset = 0;

  view.setUint32(offset, MAGIC); offset += 4;
  view.setFloat64(offset, timestamp); offset += 8;
  view.setUint32(offset, sampleRate); offset += 4;
  view.setUint8(offset, channelCount); offset += 1;
  view.setUint32(offset, samplesPerChannel); offset += 4;

  const probeTypeMap: Record<string, number> = { chirp: 0, mls: 1, golay: 2 };
  view.setUint8(offset, probeTypeMap[probeConfig.type] ?? 0); offset += 1;

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
  if (buf.byteLength < 22) return null;

  let offset = 0;
  const magic = view.getUint32(offset); offset += 4;
  if (magic !== MAGIC) return null;

  const timestamp = view.getFloat64(offset); offset += 8;
  const sampleRate = view.getUint32(offset); offset += 4;
  const channelCount = view.getUint8(offset); offset += 1;
  const samplesPerChannel = view.getUint32(offset); offset += 4;
  const probeTypeByte = view.getUint8(offset); offset += 1;

  const probeTypes = ['chirp', 'mls', 'golay'];
  const probeType = probeTypes[probeTypeByte] ?? 'chirp';

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
