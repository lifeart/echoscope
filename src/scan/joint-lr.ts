export interface JointHeatmapParams {
  profileL: Float32Array;
  profileR: Float32Array;
  anglesDeg: number[];
  minRange: number;
  maxRange: number;
  speakerSpacingM: number;
  priorRangeM?: number;
  priorSigmaM?: number;
  prevAngleDeg?: number;
  angleSigmaDeg?: number;
  edgeMaskBins?: number;
}

export interface JointHeatmapResult {
  data: Float32Array;
  bestBin: Int16Array;
  bestVal: Float32Array;
  rowScores: Float32Array;
}

function interpolateLinear(profile: Float32Array, index: number): number {
  const n = profile.length;
  if (n === 0) return 0;
  if (index <= 0) return profile[0];
  if (index >= n - 1) return profile[n - 1];
  const i0 = Math.floor(index);
  const t = index - i0;
  return profile[i0] * (1 - t) + profile[i0 + 1] * t;
}

function gaussianWeight(value: number, center: number, sigma: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(center) || !Number.isFinite(sigma) || sigma <= 0) return 1;
  const z = (value - center) / sigma;
  return Math.exp(-0.5 * z * z);
}

export function buildJointHeatmapFromLR(params: JointHeatmapParams): JointHeatmapResult {
  const {
    profileL,
    profileR,
    anglesDeg,
    minRange,
    maxRange,
    speakerSpacingM,
    priorRangeM,
    priorSigmaM,
    prevAngleDeg,
    angleSigmaDeg = 28,
  } = params;

  const bins = Math.min(profileL.length, profileR.length);
  const rows = anglesDeg.length;
  const edgeMaskBins = Math.max(1, params.edgeMaskBins ?? Math.floor(bins * 0.03));
  const data = new Float32Array(rows * bins);
  const bestBin = new Int16Array(rows).fill(-1);
  const bestVal = new Float32Array(rows);
  const rowScores = new Float32Array(rows);

  if (bins <= 1 || rows === 0 || !(maxRange > minRange)) {
    return { data, bestBin, bestVal, rowScores };
  }

  const binSize = (maxRange - minRange) / (bins - 1);
  const halfD = 0.5 * speakerSpacingM;

  for (let row = 0; row < rows; row++) {
    const thetaRad = anglesDeg[row] * Math.PI / 180;
    const sinTheta = Math.sin(thetaRad);
    const angleW = Number.isFinite(prevAngleDeg)
      ? gaussianWeight(anglesDeg[row], prevAngleDeg!, angleSigmaDeg)
      : 1;

    let rowBestVal = 0;
    let rowBestBin = -1;
    for (let bin = 0; bin < bins; bin++) {
      const idx = row * bins + bin;
      if (bin < edgeMaskBins || bin > bins - 1 - edgeMaskBins) {
        data[idx] = 0;
        continue;
      }

      const r = minRange + bin * binSize;
      const priorW = Number.isFinite(priorRangeM) && Number.isFinite(priorSigmaM)
        ? gaussianWeight(r, priorRangeM!, Math.max(1e-6, priorSigmaM!))
        : 1;

      // Near-field path-length difference: exact geometry for speaker
      // half-spacing d/2 and target at range r, angle θ.
      // ΔR = sqrt(r² + (d/2)² + r·d·sinθ) - sqrt(r² + (d/2)² - r·d·sinθ)
      // This reduces to the far-field approximation d·sin(θ)/2 when r >> d.
      const rSq = r * r;
      const halfDSq = halfD * halfD;
      const rdSin = r * speakerSpacingM * sinTheta;
      const dL = Math.sqrt(rSq + halfDSq + rdSin);
      const dR = Math.sqrt(rSq + halfDSq - rdSin);
      const shiftRange = 0.5 * (dL - dR);
      const shiftBins = shiftRange / Math.max(1e-9, binSize);

      const left = interpolateLinear(profileL, bin + shiftBins);
      const right = interpolateLinear(profileR, bin - shiftBins);
      const fused = (left > 0 && right > 0)
        ? Math.sqrt(left * right) * priorW * angleW
        : 0;
      data[idx] = fused;

      if (fused > rowBestVal) {
        rowBestVal = fused;
        rowBestBin = bin;
      }
    }

    bestBin[row] = rowBestBin;
    bestVal[row] = rowBestVal;
    rowScores[row] = rowBestVal;
  }

  return { data, bestBin, bestVal, rowScores };
}
