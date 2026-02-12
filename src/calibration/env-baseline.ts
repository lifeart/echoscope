import { absMaxNormalize } from '../dsp/normalize.js';

export function computeEnvBaseline(profiles: Float32Array[], heatBins: number): Float32Array | null {
  if (profiles.length === 0) return null;
  const acc = new Float32Array(heatBins);
  for (const prof of profiles) {
    for (let k = 0; k < heatBins; k++) acc[k] += prof[k];
  }
  const inv = 1 / profiles.length;
  for (let k = 0; k < heatBins; k++) acc[k] *= inv;
  absMaxNormalize(acc);
  return acc;
}
