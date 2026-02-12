import type { TargetState, Measurement } from '../types.js';

/**
 * Extended Kalman Filter for single-target tracking.
 * State: [range, angleDeg, rangeRate, angleRate]
 */

const STATE_DIM = 4;

function matMul4x4(A: Float64Array, B: Float64Array): Float64Array {
  const C = new Float64Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += A[i * 4 + k] * B[k * 4 + j];
      C[i * 4 + j] = sum;
    }
  }
  return C;
}

function matAdd4x4(A: Float64Array, B: Float64Array): Float64Array {
  const C = new Float64Array(16);
  for (let i = 0; i < 16; i++) C[i] = A[i] + B[i];
  return C;
}

function matTranspose4x4(A: Float64Array): Float64Array {
  const T = new Float64Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      T[j * 4 + i] = A[i * 4 + j];
  return T;
}

function identity4x4(): Float64Array {
  const I = new Float64Array(16);
  I[0] = I[5] = I[10] = I[15] = 1;
  return I;
}

// Invert 2x2 matrix [a b; c d]
function inv2x2(a: number, b: number, c: number, d: number): [number, number, number, number] {
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-15) return [1, 0, 0, 1]; // fallback to identity
  const inv = 1 / det;
  return [d * inv, -b * inv, -c * inv, a * inv];
}

export interface KalmanConfig {
  processNoiseRange: number;
  processNoiseAngle: number;
  measurementNoiseRange: number;
  measurementNoiseAngle: number;
}

export const DEFAULT_KALMAN_CONFIG: KalmanConfig = {
  processNoiseRange: 0.01,
  processNoiseAngle: 1.0,
  measurementNoiseRange: 0.05,
  measurementNoiseAngle: 2.0,
};

export function createTarget(id: number, measurement: Measurement): TargetState {
  const cov = new Float64Array(16);
  cov[0] = 0.1;   // range variance
  cov[5] = 4.0;   // angle variance
  cov[10] = 0.01; // rangeRate variance
  cov[15] = 1.0;  // angleRate variance

  return {
    id,
    position: { range: measurement.range, angleDeg: measurement.angleDeg },
    velocity: { rangeRate: 0, angleRate: 0 },
    covariance: cov,
    age: 0,
    missCount: 0,
    confidence: measurement.strength,
  };
}

export function predict(target: TargetState, dt: number, config: KalmanConfig = DEFAULT_KALMAN_CONFIG): TargetState {
  // State transition: constant velocity model
  // x_new = F * x
  const range = target.position.range + target.velocity.rangeRate * dt;
  const angle = target.position.angleDeg + target.velocity.angleRate * dt;
  const rangeRate = target.velocity.rangeRate;
  const angleRate = target.velocity.angleRate;

  // F matrix (constant velocity)
  const F = identity4x4();
  F[0 * 4 + 2] = dt; // range += rangeRate * dt
  F[1 * 4 + 3] = dt; // angle += angleRate * dt

  // Process noise Q
  const Q = new Float64Array(16);
  const qr = config.processNoiseRange * dt;
  const qa = config.processNoiseAngle * dt;
  Q[0] = qr * qr;
  Q[5] = qa * qa;
  Q[10] = qr * qr * 0.1;
  Q[15] = qa * qa * 0.1;

  // P_new = F * P * F^T + Q
  const FP = matMul4x4(F, target.covariance);
  const FPFt = matMul4x4(FP, matTranspose4x4(F));
  const P_new = matAdd4x4(FPFt, Q);

  return {
    ...target,
    position: { range: Math.max(0, range), angleDeg: angle },
    velocity: { rangeRate, angleRate },
    covariance: P_new,
    age: target.age + 1,
    missCount: target.missCount + 1,
  };
}

export function update(
  target: TargetState,
  measurement: Measurement,
  config: KalmanConfig = DEFAULT_KALMAN_CONFIG,
): TargetState {
  // Measurement model: H = [1 0 0 0; 0 1 0 0]
  // Innovation: y = z - H*x
  const zRange = measurement.range;
  const zAngle = measurement.angleDeg;
  const yRange = zRange - target.position.range;
  const yAngle = zAngle - target.position.angleDeg;

  // Innovation covariance: S = H*P*H^T + R
  const P = target.covariance;
  const R_range = config.measurementNoiseRange * config.measurementNoiseRange;
  const R_angle = config.measurementNoiseAngle * config.measurementNoiseAngle;

  const S00 = P[0] + R_range;
  const S01 = P[1];
  const S10 = P[4];
  const S11 = P[5] + R_angle;

  // Kalman gain: K = P*H^T * S^-1
  const [Si00, Si01, Si10, Si11] = inv2x2(S00, S01, S10, S11);

  // K is 4x2
  const K = new Float64Array(8);
  for (let i = 0; i < STATE_DIM; i++) {
    K[i * 2 + 0] = P[i * 4 + 0] * Si00 + P[i * 4 + 1] * Si10;
    K[i * 2 + 1] = P[i * 4 + 0] * Si01 + P[i * 4 + 1] * Si11;
  }

  // State update: x = x + K*y
  const newRange = target.position.range + K[0] * yRange + K[1] * yAngle;
  const newAngle = target.position.angleDeg + K[2] * yRange + K[3] * yAngle;
  const newRangeRate = target.velocity.rangeRate + K[4] * yRange + K[5] * yAngle;
  const newAngleRate = target.velocity.angleRate + K[6] * yRange + K[7] * yAngle;

  // Covariance update: P = (I - K*H) * P
  const KH = new Float64Array(16);
  for (let i = 0; i < STATE_DIM; i++) {
    KH[i * 4 + 0] = K[i * 2 + 0];
    KH[i * 4 + 1] = K[i * 2 + 1];
  }
  const IKH = identity4x4();
  for (let i = 0; i < 16; i++) IKH[i] -= KH[i];
  const P_new = matMul4x4(IKH, P);

  return {
    ...target,
    position: { range: Math.max(0, newRange), angleDeg: newAngle },
    velocity: { rangeRate: newRangeRate, angleRate: newAngleRate },
    covariance: P_new,
    missCount: 0,
    confidence: measurement.strength,
  };
}

export function mahalanobisDistance(target: TargetState, measurement: Measurement, config: KalmanConfig): number {
  const yRange = measurement.range - target.position.range;
  const yAngle = measurement.angleDeg - target.position.angleDeg;

  const P = target.covariance;
  const R_range = config.measurementNoiseRange * config.measurementNoiseRange;
  const R_angle = config.measurementNoiseAngle * config.measurementNoiseAngle;

  const S00 = P[0] + R_range;
  const S01 = P[1];
  const S10 = P[4];
  const S11 = P[5] + R_angle;

  const [Si00, Si01, Si10, Si11] = inv2x2(S00, S01, S10, S11);

  return Math.sqrt(
    yRange * (Si00 * yRange + Si01 * yAngle) +
    yAngle * (Si10 * yRange + Si11 * yAngle)
  );
}
