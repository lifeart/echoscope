/**
 * Feature extraction for ML inputs.
 * Takes correlation + range profile, outputs normalized feature arrays.
 */

export function extractFeatures(
  _correlation: Float32Array,
  profile: Float32Array,
  targetLength: number,
): Float32Array {
  // Normalize and pad/truncate to targetLength
  const features = new Float32Array(targetLength);

  // Use profile as primary feature
  const profLen = Math.min(profile.length, targetLength);
  let maxVal = 0;
  for (let i = 0; i < profile.length; i++) {
    if (Math.abs(profile[i]) > maxVal) maxVal = Math.abs(profile[i]);
  }
  const scale = maxVal > 1e-12 ? 1 / maxVal : 1;

  for (let i = 0; i < profLen; i++) {
    features[i] = profile[i] * scale;
  }

  return features;
}

export function correlationToSpectrogram(
  correlation: Float32Array,
  windowSize: number,
  hopSize: number,
): Float32Array[] {
  const frames: Float32Array[] = [];
  for (let start = 0; start + windowSize <= correlation.length; start += hopSize) {
    const frame = new Float32Array(windowSize);
    for (let i = 0; i < windowSize; i++) {
      frame[i] = correlation[start + i];
    }
    frames.push(frame);
  }
  return frames;
}
