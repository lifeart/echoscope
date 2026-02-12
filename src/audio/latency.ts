export interface LatencyCompensation {
  adjusted: Float32Array;
  totalLatencyMs: number;
}

export function compensateLatency(
  capturedSamples: Float32Array,
  baseLatency: number,
  outputLatency: number,
  sampleRate: number,
): LatencyCompensation {
  const totalLatencySec = baseLatency + outputLatency;
  const totalLatencyMs = totalLatencySec * 1000;
  const delaySamples = Math.round(totalLatencySec * sampleRate);

  if (delaySamples <= 0 || delaySamples >= capturedSamples.length) {
    return { adjusted: capturedSamples, totalLatencyMs };
  }

  // Trim the beginning to compensate for system latency
  const adjusted = capturedSamples.subarray(delaySamples);
  return { adjusted: new Float32Array(adjusted), totalLatencyMs };
}

export function measureRoundTripLatency(
  baseLatency: number,
  outputLatency: number,
  additionalDelayMs = 0,
): number {
  return (baseLatency + outputLatency) * 1000 + additionalDelayMs;
}
