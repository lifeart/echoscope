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
 * For exponential noise model: alpha = N * (Pfa^(-1/N) - 1)
 */
export function cfarAlpha(trainingCellCount: number, pfa: number): number {
  if (trainingCellCount <= 0 || pfa <= 0 || pfa >= 1) return 1;
  return trainingCellCount * (Math.pow(pfa, -1 / trainingCellCount) - 1);
}

/**
 * Cell-Averaging CFAR detector.
 * For each cell, estimates noise from surrounding training cells (excluding guard cells),
 * then applies a threshold multiplier to determine if the cell contains a target.
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

  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;

    // Left training cells
    for (let j = i - guard - train; j < i - guard; j++) {
      if (j >= 0 && j < n) {
        sum += profile[j];
        count++;
      }
    }

    // Right training cells
    for (let j = i + guard + 1; j <= i + guard + train; j++) {
      if (j >= 0 && j < n) {
        sum += profile[j];
        count++;
      }
    }

    const noiseEstimate = count > 0 ? sum / count : 0;
    const threshold = Math.max(cfg.minThreshold, noiseEstimate * alpha);
    thresholds[i] = threshold;

    if (profile[i] > threshold) {
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
