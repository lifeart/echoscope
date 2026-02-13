/**
 * Polyphase filter table for high-quality fractional delay interpolation.
 * Uses windowed-sinc (Kaiser window) with configurable taps and phases.
 */

export interface PolyphaseTable {
  taps: number;
  phases: number;
  coeffs: Float32Array;
}

/**
 * Zero-order modified Bessel function of the first kind (I0).
 * Used for Kaiser window computation.
 */
function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k <= 20; k++) {
    term *= (x / (2 * k)) * (x / (2 * k));
    sum += term;
    if (term < 1e-10 * sum) break;
  }
  return sum;
}

/**
 * Kaiser window value at position n for window of length N.
 */
function kaiserWindow(n: number, N: number, beta: number): number {
  const half = (N - 1) / 2;
  const ratio = (n - half) / half;
  const arg = 1 - ratio * ratio;
  if (arg < 0) return 0;
  return besselI0(beta * Math.sqrt(arg)) / besselI0(beta);
}

let cachedTable: PolyphaseTable | null = null;
let cachedParams = { taps: 0, phases: 0, beta: 0 };

/**
 * Build polyphase interpolation table.
 * @param taps Number of filter taps (default 8)
 * @param phases Number of sub-sample phases (default 32)
 * @param beta Kaiser window beta parameter (default 5.0)
 */
export function buildPolyphaseTable(taps = 8, phases = 32, beta = 5.0): PolyphaseTable {
  if (cachedTable && cachedParams.taps === taps && cachedParams.phases === phases && cachedParams.beta === beta) {
    return cachedTable;
  }

  const coeffs = new Float32Array(taps * phases);
  const halfTaps = (taps - 1) / 2;

  for (let p = 0; p < phases; p++) {
    const fracDelay = p / phases;
    let sum = 0;

    for (let t = 0; t < taps; t++) {
      const x = t - halfTaps - fracDelay;
      // Sinc function
      const sinc = Math.abs(x) < 1e-10 ? 1.0 : Math.sin(Math.PI * x) / (Math.PI * x);
      // Kaiser window
      const win = kaiserWindow(t, taps, beta);
      const val = sinc * win;
      coeffs[p * taps + t] = val;
      sum += val;
    }

    // Normalize to unity gain
    if (Math.abs(sum) > 1e-12) {
      const inv = 1 / sum;
      for (let t = 0; t < taps; t++) {
        coeffs[p * taps + t] *= inv;
      }
    }
  }

  cachedTable = { taps, phases, coeffs };
  cachedParams = { taps, phases, beta };
  return cachedTable;
}

/**
 * Get the default polyphase table (8 taps × 32 phases).
 */
export function getPolyphaseTable(): PolyphaseTable {
  return buildPolyphaseTable();
}

/**
 * Apply polyphase interpolation to shift input by a fractional delay.
 * @param input Input signal
 * @param delay Delay in samples (can be fractional)
 * @param table Polyphase table
 * @param output Output buffer (must be same length as input)
 */
export function polyphaseInterpolate(
  input: Float32Array,
  delay: number,
  table: PolyphaseTable,
  output: Float32Array,
): void {
  const n = input.length;
  const { taps, phases, coeffs } = table;
  const halfTaps = Math.floor((taps - 1) / 2);

  const intDelay = Math.floor(delay);
  const fracDelay = delay - intDelay;
  const phaseIdx = Math.min(Math.floor(fracDelay * phases), phases - 1);
  const phaseOffset = phaseIdx * taps;

  for (let i = 0; i < n; i++) {
    let sum = 0;
    const baseIdx = i - intDelay - halfTaps;

    for (let t = 0; t < taps; t++) {
      const idx = baseIdx + t;
      if (idx >= 0 && idx < n) {
        sum += input[idx] * coeffs[phaseOffset + t];
      }
    }
    output[i] = sum;
  }
}
