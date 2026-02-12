import { ensureTF, loadModel, type MLModel } from './loader.js';
import { extractFeatures } from './features.js';

/**
 * Multipath suppression CNN.
 * Input: range profile (240 bins) + raw correlation
 * Output: cleaned profile with multipath ghosts suppressed.
 */

let multipathModel: MLModel | null = null;

export async function loadMultipathNet(modelUrl: string): Promise<boolean> {
  multipathModel = await loadModel(modelUrl, 'multipath-net');
  return multipathModel !== null;
}

export async function suppressMultipath(profile: Float32Array): Promise<Float32Array> {
  if (!multipathModel) return profile;

  const tfLib = await ensureTF();
  if (!tfLib) return profile;

  try {
    const features = extractFeatures(new Float32Array(0), profile, profile.length);
    const input = tfLib.tensor2d([Array.from(features)], [1, features.length]);
    const output = multipathModel.model.predict(input) as any;
    const result = await output.data();

    input.dispose();
    output.dispose();

    // Apply mask: multiply original profile by network output (0..1 probability of real echo)
    const cleaned = new Float32Array(profile.length);
    for (let i = 0; i < profile.length; i++) {
      cleaned[i] = profile[i] * (result[i] ?? 1);
    }
    return cleaned;
  } catch (e) {
    console.warn('Multipath suppression failed:', e);
    return profile;
  }
}

export function isMultipathNetLoaded(): boolean {
  return multipathModel !== null;
}
