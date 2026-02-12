import { ensureTF, loadModel, type MLModel } from './loader.js';

/**
 * Cross-device calibration transfer model.
 * Takes device metadata + correlation, outputs calibration correction factors.
 */

let adapterModel: MLModel | null = null;

export interface DeviceMetadata {
  speakerSpacing: number;
  micPositionX: number;
  micPositionY: number;
  sampleRate: number;
}

export interface CalibrationCorrection {
  tau0Offset: number;
  gainBalanceL: number;
  gainBalanceR: number;
}

export async function loadDeviceAdapter(modelUrl: string): Promise<boolean> {
  adapterModel = await loadModel(modelUrl, 'device-adapter');
  return adapterModel !== null;
}

export async function adaptCalibration(
  metadata: DeviceMetadata,
  correlation: Float32Array,
): Promise<CalibrationCorrection> {
  const defaultCorrection: CalibrationCorrection = {
    tau0Offset: 0,
    gainBalanceL: 1.0,
    gainBalanceR: 1.0,
  };

  if (!adapterModel) return defaultCorrection;

  const tfLib = await ensureTF();
  if (!tfLib) return defaultCorrection;

  try {
    // Encode metadata + correlation summary into feature vector
    const features = [
      metadata.speakerSpacing,
      metadata.micPositionX,
      metadata.micPositionY,
      metadata.sampleRate / 48000, // normalize
    ];

    // Add correlation stats
    let sum = 0, max = 0;
    for (let i = 0; i < Math.min(correlation.length, 100); i++) {
      sum += Math.abs(correlation[i]);
      if (Math.abs(correlation[i]) > max) max = Math.abs(correlation[i]);
    }
    features.push(sum / Math.min(correlation.length, 100));
    features.push(max);

    const input = tfLib.tensor2d([features], [1, features.length]);
    const output = adapterModel.model.predict(input) as any;
    const result = await output.data();

    input.dispose();
    output.dispose();

    return {
      tau0Offset: result[0] ?? 0,
      gainBalanceL: result[1] ?? 1.0,
      gainBalanceR: result[2] ?? 1.0,
    };
  } catch (e) {
    console.warn('Device adaptation failed:', e);
    return defaultCorrection;
  }
}

export function isDeviceAdapterLoaded(): boolean {
  return adapterModel !== null;
}
