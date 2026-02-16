export function nextPow2(n: number): number {
  if (n > 0x40000000) throw new Error('FFT size exceeds maximum (2^30)');
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export function zeroPad(signal: Float32Array, targetLength: number): Float32Array {
  if (signal.length >= targetLength) return signal;
  const out = new Float32Array(targetLength);
  out.set(signal);
  return out;
}

/** In-place radix-2 Cooley-Tukey FFT. real and imag must have power-of-2 length. */
export function fft(real: Float32Array, imag: Float32Array): void {
  const N = real.length;
  if (N <= 1) return;
  if ((N & (N - 1)) !== 0) throw new Error('FFT size must be power of 2');

  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < N - 1; i++) {
    if (i < j) {
      let tmp = real[i]; real[i] = real[j]; real[j] = tmp;
      tmp = imag[i]; imag[i] = imag[j]; imag[j] = tmp;
    }
    let k = N >> 1;
    while (k <= j) { j -= k; k >>= 1; }
    j += k;
  }

  // Butterfly stages
  // Twiddle factors are computed via recurrence for speed, with periodic
  // recomputation from scratch every TWIDDLE_RESET iterations to prevent
  // floating-point drift that would otherwise degrade sidelobe cancellation
  // (e.g. Golay pairs) for large FFT sizes (N >= 2^16).
  const TWIDDLE_RESET = 64;
  for (let size = 2; size <= N; size <<= 1) {
    const halfSize = size >> 1;
    const angle = -2 * Math.PI / size;
    const wR = Math.cos(angle);
    const wI = Math.sin(angle);

    for (let i = 0; i < N; i += size) {
      let curR = 1, curI = 0;
      for (let k = 0; k < halfSize; k++) {
        // Reset twiddle factor from scratch periodically to bound
        // accumulated floating-point error to O(1) ULP.
        if (k > 0 && k % TWIDDLE_RESET === 0) {
          const a = angle * k;
          curR = Math.cos(a);
          curI = Math.sin(a);
        }
        const evenIdx = i + k;
        const oddIdx = i + k + halfSize;
        const tR = curR * real[oddIdx] - curI * imag[oddIdx];
        const tI = curR * imag[oddIdx] + curI * real[oddIdx];
        real[oddIdx] = real[evenIdx] - tR;
        imag[oddIdx] = imag[evenIdx] - tI;
        real[evenIdx] += tR;
        imag[evenIdx] += tI;
        const newR = curR * wR - curI * wI;
        curI = curR * wI + curI * wR;
        curR = newR;
      }
    }
  }
}

/** In-place inverse FFT. */
export function ifft(real: Float32Array, imag: Float32Array): void {
  const N = real.length;
  // Conjugate
  for (let i = 0; i < N; i++) imag[i] = -imag[i];
  fft(real, imag);
  // Conjugate and scale
  const inv = 1 / N;
  for (let i = 0; i < N; i++) {
    real[i] *= inv;
    imag[i] = -imag[i] * inv;
  }
}
