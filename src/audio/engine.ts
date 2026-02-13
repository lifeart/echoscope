import { store } from '../core/store.js';
import { bus } from '../core/event-bus.js';
import { RingBuffer } from './ring-buffer.js';
import { DEFAULT_BUFFER_SECONDS } from '../constants.js';

let ringBuffer: RingBuffer | null = null;

function describeMediaError(error: unknown): string {
  if (error instanceof Error) {
    const maybeName = (error as any).name ? `${(error as any).name}: ` : '';
    return `${maybeName}${error.message}`;
  }
  return String(error);
}

async function requestMicrophoneStream(): Promise<MediaStream> {
  if (!window.isSecureContext) {
    throw new Error('Microphone requires secure context (HTTPS or localhost).');
  }

  const getUserMedia = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
  if (!getUserMedia) {
    throw new Error('navigator.mediaDevices.getUserMedia is unavailable in this browser/context.');
  }

  const attempts: Array<MediaTrackConstraints | boolean> = [
    {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2 },
    },
    {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    true,
  ];

  const errors: string[] = [];
  for (const audio of attempts) {
    try {
      return await getUserMedia({ audio });
    } catch (error) {
      errors.push(describeMediaError(error));
    }
  }

  throw new Error(`Microphone permission/initialization failed. Attempts: ${errors.join(' | ')}`);
}

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
  // Resume immediately within the user-gesture call stack (required on iOS Safari)
  if (ac.state !== 'running') await ac.resume();
  const sampleRate = ac.sampleRate;

  const micStream = await requestMicrophoneStream();

  const micSource = ac.createMediaStreamSource(micStream);
  const actualChannels = micSource.channelCount;
  ringBuffer = new RingBuffer(actualChannels, Math.floor(sampleRate * DEFAULT_BUFFER_SECONDS));

  let captureMethod: 'worklet' | 'script-processor' = 'script-processor';
  let micTapNode: AudioNode;

  try {
    const workletCode = `
      class MicTapProcessor extends AudioWorkletProcessor {
        process(inputs) {
          const input = inputs[0];
          if (!input || !input[0] || !input[0].length) return true;
          const channels = [];
          for (let c = 0; c < input.length; c++) {
            const copy = new Float32Array(input[c].length);
            copy.set(input[c]);
            channels.push(copy);
          }
          this.port.postMessage(channels);
          return true;
        }
      }
      registerProcessor('mic-tap', MicTapProcessor);
    `;
    const blob = new Blob([workletCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    await ac.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    const workletNode = new AudioWorkletNode(ac, 'mic-tap', {
      channelCount: actualChannels,
      channelCountMode: 'explicit',
    });
    workletNode.port.onmessage = (e: MessageEvent) => {
      const channels = e.data as Float32Array[];
      ringBuffer?.push(channels);
      bus.emit('audio:samples', channels[0]);
    };
    micSource.connect(workletNode);
    micTapNode = workletNode;
    captureMethod = 'worklet';
  } catch {
    const sp = ac.createScriptProcessor(1024, actualChannels, actualChannels);
    sp.onaudioprocess = (ev: AudioProcessingEvent) => {
      const channels: Float32Array[] = [];
      for (let c = 0; c < ev.inputBuffer.numberOfChannels; c++) {
        const input = ev.inputBuffer.getChannelData(c);
        const copy = new Float32Array(input.length);
        copy.set(input);
        channels.push(copy);
      }
      ringBuffer?.push(channels);
      bus.emit('audio:samples', channels[0]);
    };
    micSource.connect(sp);
    sp.connect(ac.destination);
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
    s.audio.channelCount = actualChannels;
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
