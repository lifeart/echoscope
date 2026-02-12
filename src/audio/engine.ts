import { store } from '../core/store.js';
import { bus } from '../core/event-bus.js';
import { RingBuffer } from './ring-buffer.js';
import { DEFAULT_BUFFER_SECONDS } from '../constants.js';

let ringBuffer: RingBuffer | null = null;

export function getRingBuffer(): RingBuffer | null {
  return ringBuffer;
}

export function computeListenSamples(listenMs: number, refLength: number, sampleRate: number): number {
  const listenMsSafe = Number.isFinite(listenMs) ? Math.max(0, listenMs) : 0;
  const byMs = Math.floor(sampleRate * (listenMsSafe / 1000));
  const refLen = Number.isFinite(refLength) ? Math.max(0, refLength | 0) : 0;
  const refNeed = refLen + Math.floor(sampleRate * 0.030);
  return Math.max(2048, byMs, refNeed);
}

export async function resumeIfSuspended(): Promise<void> {
  const ctx = store.get().audio.context;
  if (ctx && ctx.state !== 'running') await ctx.resume();
}

export async function initAudio(): Promise<void> {
  const state = store.get();

  if (state.audio.context) {
    await resumeIfSuspended();
    return;
  }

  const ac = new AudioContext({ latencyHint: 'interactive' });
  const sampleRate = ac.sampleRate;

  const micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  });

  const micSource = ac.createMediaStreamSource(micStream);
  ringBuffer = new RingBuffer(1, Math.floor(sampleRate * DEFAULT_BUFFER_SECONDS));

  let captureMethod: 'worklet' | 'script-processor' = 'script-processor';
  let micTapNode: AudioNode;

  try {
    const workletCode = `
      class MicTapProcessor extends AudioWorkletProcessor {
        process(inputs) {
          const input = inputs[0];
          if (input && input[0] && input[0].length) this.port.postMessage(input[0]);
          return true;
        }
      }
      registerProcessor('mic-tap', MicTapProcessor);
    `;
    const blob = new Blob([workletCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    await ac.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    const workletNode = new AudioWorkletNode(ac, 'mic-tap');
    workletNode.port.onmessage = (e: MessageEvent) => {
      const samples = e.data as Float32Array;
      const copy = new Float32Array(samples.length);
      copy.set(samples);
      ringBuffer?.pushMono(copy);
      bus.emit('audio:samples', copy);
    };
    micSource.connect(workletNode);
    micTapNode = workletNode;
    captureMethod = 'worklet';
  } catch {
    const sp = ac.createScriptProcessor(1024, 1, 1);
    sp.onaudioprocess = (ev: AudioProcessingEvent) => {
      const input = ev.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input.length);
      copy.set(input);
      ringBuffer?.pushMono(copy);
      bus.emit('audio:samples', copy);
    };
    micSource.connect(sp);
    micTapNode = sp;
    captureMethod = 'script-processor';
  }

  // Keep reference to prevent GC
  (ac as any)._micStream = micStream;
  (ac as any)._micSource = micSource;
  (ac as any)._micTapNode = micTapNode;

  await resumeIfSuspended();

  store.update(s => {
    s.audio.context = ac;
    s.audio.actualSampleRate = sampleRate;
    s.audio.channelCount = 1;
    s.audio.baseLatency = ac.baseLatency ?? 0;
    s.audio.outputLatency = (ac as any).outputLatency ?? 0;
    s.audio.captureMethod = captureMethod;
    s.audio.isRunning = true;
    s.status = 'ready';
  });

  bus.emit('audio:initialized', store.get().audio);
}

export function getAudioContext(): AudioContext {
  const ctx = store.get().audio.context;
  if (!ctx) throw new Error('Audio not initialized');
  return ctx;
}

export function getSampleRate(): number {
  return store.get().audio.actualSampleRate;
}
