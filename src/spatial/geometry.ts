export function estimateMicXY(rL: number, rR: number, d: number): { x: number; y: number; err: number } {
  const x = (rL * rL - rR * rR) / (2 * d);
  const y2 = rR * rR - (x - d / 2) * (x - d / 2);
  const y = Math.sqrt(Math.max(0, y2));

  // Error: how far outside the valid triangle the measurements are.
  // If y2 < 0, the triangle (rL, rR, d) is geometrically impossible.
  // Normalize by rR² so the error is scale-independent (0 = perfect, >1 = very bad).
  const denom = Math.max(1e-12, rR * rR);
  const err = y2 < 0 ? Math.abs(y2) / denom : 0;

  return { x, y, err };
}

export function computeArraySpacing(speakers: Array<{ x: number; y: number; z: number }>): number {
  if (speakers.length < 2) return 0;
  const dx = speakers[1].x - speakers[0].x;
  const dy = speakers[1].y - speakers[0].y;
  const dz = speakers[1].z - speakers[0].z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function distanceBetween(
  a: { x: number; y: number; z?: number },
  b: { x: number; y: number; z?: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
