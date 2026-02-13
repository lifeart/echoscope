/**
 * Uncertainty ellipse rendering for geometry plot.
 * Transforms (range, angle) covariance to Cartesian (u, f) and draws an ellipse.
 */

/**
 * Transform covariance from polar (range, angleDeg) to Cartesian (u, f).
 * Uses Jacobian of the polar→Cartesian transform:
 *   u = range * sin(angle), f = range * cos(angle)
 *
 * @param range Target range in meters
 * @param angleDeg Target angle in degrees
 * @param cov4x4 4×4 covariance matrix [range, angle, rangeRate, angleRate] (Float64Array, row-major)
 * @returns 2×2 Cartesian covariance components
 */
export function positionCovarianceUF(
  range: number,
  angleDeg: number,
  cov4x4: Float64Array,
): { sigUU: number; sigFF: number; sigUF: number } {
  const theta = angleDeg * Math.PI / 180;
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);

  // Extract 2×2 position covariance from the 4×4 matrix
  // [0,0]=var(range), [0,1]=cov(range,angle), [1,0]=cov(angle,range), [1,1]=var(angle)
  const sigRR = cov4x4[0];         // variance of range
  const sigRA = cov4x4[1];         // cov(range, angle)
  const sigAA = cov4x4[5];         // variance of angle (index [1,1] in 4×4 = 1*4+1=5)

  // Convert angle variance from deg² to rad²
  const degToRad = Math.PI / 180;
  const sigAA_rad = sigAA * degToRad * degToRad;
  const sigRA_rad = sigRA * degToRad;

  // Jacobian: J = [du/dr, du/dtheta; df/dr, df/dtheta]
  //           = [sin(theta), range*cos(theta); cos(theta), -range*sin(theta)]
  const j00 = sinT;           // du/dr
  const j01 = range * cosT;   // du/dtheta
  const j10 = cosT;           // df/dr
  const j11 = -range * sinT;  // df/dtheta

  // C_uf = J * C_ra * J^T
  const sigUU = j00 * j00 * sigRR + 2 * j00 * j01 * sigRA_rad + j01 * j01 * sigAA_rad;
  const sigFF = j10 * j10 * sigRR + 2 * j10 * j11 * sigRA_rad + j11 * j11 * sigAA_rad;
  const sigUF = j00 * j10 * sigRR + (j00 * j11 + j01 * j10) * sigRA_rad + j01 * j11 * sigAA_rad;

  return { sigUU, sigFF, sigUF };
}

/**
 * Convert 2×2 covariance to ellipse parameters via eigendecomposition.
 *
 * @param sigUU Variance in U direction
 * @param sigFF Variance in F direction
 * @param sigUF Covariance U-F
 * @param k Confidence scale (k=2.146 for 90%, k=1.0 for 1-sigma ~39%)
 * @returns Ellipse semi-axes and rotation angle
 */
export function covarianceToEllipse(
  sigUU: number,
  sigFF: number,
  sigUF: number,
  k = 2.146,
): { semiMajor: number; semiMinor: number; rotationRad: number } {
  // Eigenvalues of 2×2 symmetric matrix [[sigUU, sigUF], [sigUF, sigFF]]
  const trace = sigUU + sigFF;
  const det = sigUU * sigFF - sigUF * sigUF;
  const discriminant = Math.max(0, trace * trace / 4 - det);
  const sqrtDisc = Math.sqrt(discriminant);

  const lambda1 = Math.max(0, trace / 2 + sqrtDisc);
  const lambda2 = Math.max(0, trace / 2 - sqrtDisc);

  const semiMajor = k * Math.sqrt(lambda1);
  const semiMinor = k * Math.sqrt(lambda2);

  // Rotation angle (angle of the eigenvector corresponding to lambda1)
  const rotationRad = 0.5 * Math.atan2(2 * sigUF, sigUU - sigFF);

  return { semiMajor, semiMinor, rotationRad };
}

export interface EllipseParams {
  cx: number;
  cy: number;
  semiMajorPx: number;
  semiMinorPx: number;
  rotationRad: number;
}

/**
 * Draw an uncertainty ellipse on a canvas.
 */
export function drawEllipse(
  ctx: CanvasRenderingContext2D,
  params: EllipseParams,
  color: string,
  lineWidth: number,
): void {
  if (params.semiMajorPx < 0.5 || params.semiMinorPx < 0.5) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.ellipse(
    params.cx, params.cy,
    Math.min(params.semiMajorPx, 200),
    Math.min(params.semiMinorPx, 200),
    params.rotationRad,
    0, Math.PI * 2,
  );
  ctx.stroke();
  ctx.restore();
}
