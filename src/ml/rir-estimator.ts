import { ensureTF, loadModel, type MLModel } from './loader.js';

/**
 * Room Impulse Response inference model.
 * Takes correlation output, estimates RIR.
 */

let rirModel: MLModel | null = null;

export async function loadRIREstimator(modelUrl: string): Promise<boolean> {
  rirModel = await loadModel(modelUrl, 'rir-estimator');
  return rirModel !== null;
}

export async function estimateRIR(correlation: Float32Array): Promise<Float32Array | null> {
  if (!rirModel) return null;

  const tfLib = await ensureTF();
  if (!tfLib) return null;

  try {
    const inputLen = rirModel.inputShape[0];
    const padded = new Float32Array(inputLen);
    const copyLen = Math.min(correlation.length, inputLen);
    padded.set(correlation.subarray(0, copyLen));

    const input = tfLib.tensor2d([Array.from(padded)], [1, inputLen]);
    const output = rirModel.model.predict(input) as any;
    const result = await output.data();

    input.dispose();
    output.dispose();

    return new Float32Array(result);
  } catch (e) {
    console.warn('RIR estimation failed:', e);
    return null;
  }
}

export function isRIREstimatorLoaded(): boolean {
  return rirModel !== null;
}
