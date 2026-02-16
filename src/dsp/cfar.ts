export interface CfarConfig {
  guardCells: number;
  trainingCells: number;
  pfa: number;
  minThreshold: number;
}

export interface CfarResult {
  thresholds: Float32Array;
  detections: Uint8Array;
  detectionCount: number;
}

const DEFAULT_CFAR: CfarConfig = {
  guardCells: 2,
  trainingCells: 8,
  pfa: 1e-3,
  minThreshold: 1e-6,
};

/**
 * Compute CFAR threshold multiplier alpha for CA-CFAR.
 *
 * The profile is expected to be in the **amplitude** (magnitude) domain.
 * Amplitude samples of complex Gaussian noise follow a Rayleigh distribution
 * whose squared values are exponential. Working in the squared (power) domain
 * is the standard for CA-CFAR, so the detector internally squares the profile
 * bins for noise estimation and comparison, then returns thresholds in the
 * original amplitude domain for caller convenience.
 *
 * Alpha is derived from the exponential CDF:
 *   alpha = N * (Pfa^(-1/N) - 1)
 * where N = 2 * trainingCellCount (both sides).
 */
export function cfarAlpha(trainingCellCount: number, pfa: number): number {
  if (trainingCellCount <= 0 || pfa <= 0 || pfa >= 1) return 1;
  return trainingCellCount * (Math.pow(pfa, -1 / trainingCellCount) - 1);
}

/**
 * Cell-Averaging CFAR detector operating in the **power domain**.
 *
 * Input profile values are squared internally so that the exponential noise
 * model (upon which the alpha formula is based) is properly applied to
 * chi-squared / exponential samples rather than Rayleigh magnitudes.
 * Returned thresholds are converted back to the amplitude domain so that
 * callers can compare directly against the original profile values.
 */
export function caCfar(profile: Float32Array, config?: Partial<CfarConfig>): CfarResult {
  const cfg: CfarConfig = { ...DEFAULT_CFAR, ...config };
  const n = profile.length;
  const thresholds = new Float32Array(n);
  const detections = new Uint8Array(n);
  let detectionCount = 0;

  if (n === 0) return { thresholds, detections, detectionCount };

  const guard = Math.max(0, cfg.guardCells);
  const train = Math.max(1, cfg.trainingCells);
  const alpha = cfarAlpha(2 * train, cfg.pfa);

  // Pre-compute power (squared amplitude) for each bin
  const power = new Float32Array(n);
  for (let i = 0; i < n; i++) power[i] = profile[i] * profile[i];

  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;

    // Left training cells
    for (let j = i - guard - train; j < i - guard; j++) {
      if (j >= 0 && j < n) {
        sum += power[j];
        count++;
      }
    }

    // Right training cells
    for (let j = i + guard + 1; j <= i + guard + train; j++) {
      if (j >= 0 && j < n) {
        sum += power[j];
        count++;
      }
    }

    const noiseEstimate = count > 0 ? sum / count : 0;
    // Threshold in power domain, converted back to amplitude
    const thresholdPower = Math.max(cfg.minThreshold * cfg.minThreshold, noiseEstimate * alpha);
    const thresholdAmplitude = Math.sqrt(thresholdPower);
    thresholds[i] = thresholdAmplitude;

    if (profile[i] > thresholdAmplitude) {
      detections[i] = 1;
      detectionCount++;
    }
  }

  return { thresholds, detections, detectionCount };
}

/**
 * Apply CFAR filter: zero out non-detected bins.
 */
export function applyCfarFilter(
  profile: Float32Array,
  config?: Partial<CfarConfig>,
): { filtered: Float32Array; result: CfarResult } {
  const result = caCfar(profile, config);
  const filtered = new Float32Array(profile.length);
  for (let i = 0; i < profile.length; i++) {
    filtered[i] = result.detections[i] ? profile[i] : 0;
  }
  return { filtered, result };
}
