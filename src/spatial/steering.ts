import { sleep } from '../utils.js';
import { getRingBuffer, computeListenSamples, getAudioContext, getSampleRate } from '../audio/engine.js';
import { store } from '../core/store.js';

/** Extra margin (seconds) to account for WorkletProcessor→main-thread postMessage latency
 *  and AudioContext scheduling jitter. */
const CAPTURE_MARGIN_SEC = 0.12;

/** Wait for ring buffer to advance by at least `minSamples` from `startPos`,
 *  with a hard timeout to avoid infinite hangs. */
async function waitForRingAdvance(minSamples: number, startPos: number, timeoutMs = 500): Promise<void> {
  const ring = getRingBuffer();
  if (!ring) return;
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const pos = ring.position;
    const advanced = pos >= startPos
      ? pos - startPos
      : (ring.size - startPos) + pos;  // wrapped
    if (advanced >= minSamples) return;
    await sleep(4);
  }
}

interface StereoPing {
  srcL: AudioBufferSourceNode;
  srcR: AudioBufferSourceNode;
  out: ChannelMergerNode;
  pingSec: number;
  delayL: number;
  delayR: number;
}

export function buildStereoPingCustom(
  mono: Float32Array,
  gainL: number,
  gainR: number,
  delayL: number,
  delayR: number,
): StereoPing {
  const ac = getAudioContext();
  const sr = getSampleRate();
  const buf = ac.createBuffer(1, mono.length, sr);
  buf.copyToChannel(new Float32Array(mono), 0);

  const srcL = ac.createBufferSource();
  const srcR = ac.createBufferSource();
  srcL.buffer = buf;
  srcR.buffer = buf;

  const gL = ac.createGain(); gL.gain.value = gainL;
  const gR = ac.createGain(); gR.gain.value = gainR;

  const dL = ac.createDelay(0.12); dL.delayTime.value = delayL;
  const dR = ac.createDelay(0.12); dR.delayTime.value = delayR;

  const merger = ac.createChannelMerger(2);
  srcL.connect(gL).connect(dL).connect(merger, 0, 0);
  srcR.connect(gR).connect(dR).connect(merger, 0, 1);

  return { srcL, srcR, out: merger, pingSec: mono.length / sr, delayL, delayR };
}

export function buildSteeredStereoPing(mono: Float32Array, dtSeconds: number, gain: number): StereoPing {
  const t0 = 0.012;
  let delayL = t0, delayR = t0;
  if (dtSeconds >= 0) delayR = t0 + dtSeconds;
  else delayL = t0 + (-dtSeconds);
  return buildStereoPingCustom(mono, gain, gain, delayL, delayR);
}

export function buildStereoPingForOneSide(
  mono: Float32Array,
  which: 'L' | 'R',
  gain: number,
  delaySec: number,
): StereoPing {
  const gL = which === 'L' ? gain : 0.0;
  const gR = which === 'R' ? gain : 0.0;
  return buildStereoPingCustom(mono, gL, gR, delaySec, delaySec);
}

export async function pingAndCaptureOneSide(
  monoRef: Float32Array,
  which: 'L' | 'R',
  gain: number,
  listenMs: number,
): Promise<{ micWin: Float32Array; micChannels: Float32Array[]; which: 'L' | 'R'; delay: number }> {
  const ac = getAudioContext();
  const sr = getSampleRate();
  const ring = getRingBuffer();
  if (!ring) throw new Error('Ring buffer not initialized');

  const delay = 0.012;
  const ping = buildStereoPingForOneSide(monoRef, which, gain, delay);
  ping.out.connect(ac.destination);

  const audioLatency = (store.get().audio.baseLatency || 0) + (store.get().audio.outputLatency || 0);
  const ringBefore = ring.position;
  const tStart = ac.currentTime + 0.03;
  ping.srcL.start(tStart);
  ping.srcR.start(tStart);

  const emitDelay = delay + ping.pingSec;
  const totalWaitSec = emitDelay + audioLatency + CAPTURE_MARGIN_SEC;
  await sleep(totalWaitSec * 1000);

  // Ensure ring buffer has caught up with expected data
  const listenSamples = computeListenSamples(listenMs, monoRef.length, sr);
  const expectedAdvance = Math.ceil(totalWaitSec * sr);
  await waitForRingAdvance(Math.min(expectedAdvance, listenSamples), ringBefore);

  const end = ring.position;
  const micWin = ring.read(end, listenSamples);
  const micChannels = ring.channels > 1 ? ring.readMulti(end, listenSamples) : [micWin];

  ping.out.disconnect();
  return { micWin, micChannels, which, delay };
}

export async function pingAndCaptureSteered(
  monoRef: Float32Array,
  dt: number,
  gain: number,
  listenMs: number,
): Promise<{ micWin: Float32Array; micChannels: Float32Array[]; delayL: number; delayR: number }> {
  const ac = getAudioContext();
  const sr = getSampleRate();
  const ring = getRingBuffer();
  if (!ring) throw new Error('Ring buffer not initialized');

  const ping = buildSteeredStereoPing(monoRef, dt, gain);
  ping.out.connect(ac.destination);

  const audioLatency = (store.get().audio.baseLatency || 0) + (store.get().audio.outputLatency || 0);
  const ringBefore = ring.position;
  const tStart = ac.currentTime + 0.03;
  ping.srcL.start(tStart);
  ping.srcR.start(tStart);

  const emitDelay = Math.max(ping.delayL, ping.delayR) + ping.pingSec;
  const totalWaitSec = emitDelay + audioLatency + CAPTURE_MARGIN_SEC;
  await sleep(totalWaitSec * 1000);

  // Ensure ring buffer has caught up with expected data
  const listenSamples = computeListenSamples(listenMs, monoRef.length, sr);
  const expectedAdvance = Math.ceil(totalWaitSec * sr);
  await waitForRingAdvance(Math.min(expectedAdvance, listenSamples), ringBefore);

  const end = ring.position;
  const micWin = ring.read(end, listenSamples);
  const micChannels = ring.channels > 1 ? ring.readMulti(end, listenSamples) : [micWin];

  ping.out.disconnect();
  return { micWin, micChannels, delayL: ping.delayL, delayR: ping.delayR };
}

export function computeSteeringDelay(angleDeg: number, spacing: number, speedOfSound: number): number {
  if (speedOfSound <= 0) return 0;
  const theta = angleDeg * Math.PI / 180;
  return (spacing * Math.sin(theta)) / speedOfSound;
}
