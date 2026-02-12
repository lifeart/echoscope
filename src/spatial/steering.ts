import { sleep } from '../utils.js';
import { getRingBuffer, computeListenSamples, getAudioContext, getSampleRate } from '../audio/engine.js';

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
): Promise<{ micWin: Float32Array; which: 'L' | 'R'; delay: number }> {
  const ac = getAudioContext();
  const sr = getSampleRate();
  const ring = getRingBuffer();
  if (!ring) throw new Error('Ring buffer not initialized');

  const delay = 0.012;
  const ping = buildStereoPingForOneSide(monoRef, which, gain, delay);
  ping.out.connect(ac.destination);

  const tStart = ac.currentTime + 0.03;
  ping.srcL.start(tStart);
  ping.srcR.start(tStart);

  const emitDelay = delay + ping.pingSec;
  await sleep((emitDelay + 0.040) * 1000);

  const end = ring.position;
  const listenSamples = computeListenSamples(listenMs, monoRef.length, sr);
  const micWin = ring.read(end, listenSamples);

  ping.out.disconnect();
  return { micWin, which, delay };
}

export async function pingAndCaptureSteered(
  monoRef: Float32Array,
  dt: number,
  gain: number,
  listenMs: number,
): Promise<{ micWin: Float32Array; delayL: number; delayR: number }> {
  const ac = getAudioContext();
  const sr = getSampleRate();
  const ring = getRingBuffer();
  if (!ring) throw new Error('Ring buffer not initialized');

  const ping = buildSteeredStereoPing(monoRef, dt, gain);
  ping.out.connect(ac.destination);

  const tStart = ac.currentTime + 0.03;
  ping.srcL.start(tStart);
  ping.srcR.start(tStart);

  const emitDelay = Math.max(ping.delayL, ping.delayR) + ping.pingSec;
  await sleep((emitDelay + 0.040) * 1000);

  const end = ring.position;
  const listenSamples = computeListenSamples(listenMs, monoRef.length, sr);
  const micWin = ring.read(end, listenSamples);

  ping.out.disconnect();
  return { micWin, delayL: ping.delayL, delayR: ping.delayR };
}

export function computeSteeringDelay(angleDeg: number, spacing: number, speedOfSound: number): number {
  if (speedOfSound <= 0) return 0;
  const theta = angleDeg * Math.PI / 180;
  return (spacing * Math.sin(theta)) / speedOfSound;
}
