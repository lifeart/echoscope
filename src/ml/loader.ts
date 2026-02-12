/**
 * TensorFlow.js model loading & lifecycle.
 * Dynamically imports @tensorflow/tfjs to avoid hard dependency.
 */

export interface MLModel {
  model: any; // tf.LayersModel
  name: string;
  inputShape: number[];
  outputShape: number[];
}

let tf: any = null;

export async function ensureTF(): Promise<any> {
  if (tf) return tf;
  try {
    tf = await import('@tensorflow/tfjs');
    // Prefer WebGL backend, fall back to Wasm/CPU
    try {
      await tf.setBackend('webgl');
    } catch {
      try {
        await tf.setBackend('wasm');
      } catch {
        await tf.setBackend('cpu');
      }
    }
    await tf.ready();
    return tf;
  } catch (e) {
    console.warn('TensorFlow.js not available:', e);
    return null;
  }
}

export async function loadModel(url: string, name: string): Promise<MLModel | null> {
  const tfLib = await ensureTF();
  if (!tfLib) return null;

  try {
    const model = await tfLib.loadLayersModel(url);
    const inputShape = model.inputs[0].shape.slice(1).map((d: number | null) => d ?? 0);
    const outputShape = model.outputs[0].shape.slice(1).map((d: number | null) => d ?? 0);

    // Warmup
    const warmupInput = tfLib.zeros([1, ...inputShape]);
    model.predict(warmupInput).dispose();
    warmupInput.dispose();

    return { model, name, inputShape, outputShape };
  } catch (e) {
    console.warn(`Failed to load model '${name}':`, e);
    return null;
  }
}

export function disposeModel(mlModel: MLModel): void {
  mlModel.model?.dispose();
}
