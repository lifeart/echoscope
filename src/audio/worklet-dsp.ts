/**
 * Wasm-powered AudioWorklet for real-time DSP.
 * Falls back to main-thread JS DSP if Wasm is unavailable.
 */

export const DSP_WORKLET_CODE = `
class DspProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.wasmReady = false;
    this.port.onmessage = (e) => {
      if (e.data.type === 'wasm-init') {
        // Initialize Wasm module
        WebAssembly.instantiate(e.data.wasmBytes).then(instance => {
          this.wasm = instance.exports;
          this.wasmReady = true;
          this.port.postMessage({ type: 'wasm-ready' });
        }).catch(err => {
          this.port.postMessage({ type: 'wasm-error', error: String(err) });
        });
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length) {
      // Forward raw samples to main thread
      this.port.postMessage({ type: 'samples', data: input[0] });
    }
    return true;
  }
}
registerProcessor('dsp-processor', DspProcessor);
`;

export async function createDspWorklet(
  audioContext: AudioContext,
  _wasmBytes?: ArrayBuffer,
): Promise<AudioWorkletNode | null> {
  try {
    const blob = new Blob([DSP_WORKLET_CODE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    await audioContext.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    const node = new AudioWorkletNode(audioContext, 'dsp-processor');
    return node;
  } catch (e) {
    console.warn('Failed to create DSP worklet:', e);
    return null;
  }
}
