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

/** Wrap angle difference to [-180, 180]. */
function wrapAngle(deg: number): number {
  return ((deg + 180) % 360 + 360) % 360 - 180;
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
  const dtSafe = Number.isFinite(dt) && dt > 0 ? dt : 0;

  // State transition: constant velocity model
  // x_new = F * x
  const range = target.position.range + target.velocity.rangeRate * dtSafe;
  const angle = target.position.angleDeg + target.velocity.angleRate * dtSafe;
  const rangeRate = target.velocity.rangeRate;
  const angleRate = target.velocity.angleRate;

  // F matrix (constant velocity)
  const F = identity4x4();
  F[0 * 4 + 2] = dtSafe; // range += rangeRate * dt
  F[1 * 4 + 3] = dtSafe; // angle += angleRate * dt

  // Process noise Q — continuous white-noise jerk model
  // Q block for [pos, vel] = q * [[dt³/3, dt²/2],[dt²/2, dt]]
  const Q = new Float64Array(16);
  const qr = config.processNoiseRange;
  const qa = config.processNoiseAngle;
  const dt2 = dtSafe * dtSafe;
  const dt3 = dt2 * dtSafe;
  Q[0]  = qr * dt3 / 3;   // range variance
  Q[2]  = qr * dt2 / 2;   // range–rangeRate cross
  Q[8]  = qr * dt2 / 2;   // rangeRate–range cross
  Q[10] = qr * dtSafe;         // rangeRate variance
  Q[5]  = qa * dt3 / 3;   // angle variance
  Q[7]  = qa * dt2 / 2;   // angle–angleRate cross
  Q[13] = qa * dt2 / 2;   // angleRate–angle cross
  Q[15] = qa * dtSafe;         // angleRate variance

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
  const yAngle = wrapAngle(zAngle - target.position.angleDeg);

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

  // Joseph-form covariance update: P = (I-KH)*P*(I-KH)^T + K*R*K^T
  const KH = new Float64Array(16);
  for (let i = 0; i < STATE_DIM; i++) {
    KH[i * 4 + 0] = K[i * 2 + 0];
    KH[i * 4 + 1] = K[i * 2 + 1];
  }
  const IKH = identity4x4();
  for (let i = 0; i < 16; i++) IKH[i] -= KH[i];
  const IKH_P = matMul4x4(IKH, P);
  const joseph = matMul4x4(IKH_P, matTranspose4x4(IKH));
  // K * R * K^T  (R is diagonal: R_range, R_angle)
  const KRKT = new Float64Array(16);
  for (let i = 0; i < STATE_DIM; i++) {
    for (let j = 0; j < STATE_DIM; j++) {
      KRKT[i * 4 + j] = K[i * 2 + 0] * R_range * K[j * 2 + 0]
                       + K[i * 2 + 1] * R_angle * K[j * 2 + 1];
    }
  }
  const P_new = matAdd4x4(joseph, KRKT);

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
  const yAngle = wrapAngle(measurement.angleDeg - target.position.angleDeg);

  const P = target.covariance;
  const R_range = config.measurementNoiseRange * config.measurementNoiseRange;
  const R_angle = config.measurementNoiseAngle * config.measurementNoiseAngle;

  const S00 = P[0] + R_range;
  const S01 = P[1];
  const S10 = P[4];
  const S11 = P[5] + R_angle;

  const [Si00, Si01, Si10, Si11] = inv2x2(S00, S01, S10, S11);

  const d2 = yRange * (Si00 * yRange + Si01 * yAngle) +
    yAngle * (Si10 * yRange + Si11 * yAngle);
  return Math.sqrt(Math.max(0, d2));
}
