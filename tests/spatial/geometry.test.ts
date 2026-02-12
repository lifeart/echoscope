import { estimateMicXY, computeArraySpacing, distanceBetween } from '../../src/spatial/geometry.js';

describe('estimateMicXY', () => {
  it('places mic at center when ranges are equal', () => {
    const result = estimateMicXY(0.15, 0.15, 0.245);
    expect(result.x).toBeCloseTo(0, 4);
    expect(result.err).toBeCloseTo(0, 4);
  });

  it('offsets mic toward shorter range', () => {
    const d = 0.245;
    // Mic closer to left speaker → rL < rR → x < 0
    const result = estimateMicXY(0.12, 0.18, d);
    expect(result.x).toBeLessThan(0);
    expect(result.err).toBeCloseTo(0, 1);
  });

  it('reports error when triangle inequality fails', () => {
    // rL + rR < d → impossible triangle
    const result = estimateMicXY(0.01, 0.01, 0.245);
    expect(result.err).toBeGreaterThan(0);
  });

  it('places mic on speaker line when y=0', () => {
    const d = 0.20;
    // Mic exactly on the right speaker: rR=0 would be degenerate,
    // but mic on the line between speakers gives y=0
    const rL = 0.15;
    const rR = 0.05;
    const result = estimateMicXY(rL, rR, d);
    // x = (rL²-rR²)/(2d) = (0.0225-0.0025)/0.4 = 0.05
    expect(result.x).toBeCloseTo(0.05, 4);
  });
});

describe('computeArraySpacing', () => {
  it('computes 3D distance between two speakers', () => {
    const spacing = computeArraySpacing([
      { x: -0.1, y: 0, z: 0 },
      { x: 0.1, y: 0, z: 0 },
    ]);
    expect(spacing).toBeCloseTo(0.2, 6);
  });

  it('returns 0 for single speaker', () => {
    expect(computeArraySpacing([{ x: 0, y: 0, z: 0 }])).toBe(0);
  });
});

describe('distanceBetween', () => {
  it('computes 2D distance', () => {
    const dist = distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 });
    expect(dist).toBeCloseTo(5, 6);
  });

  it('computes 3D distance', () => {
    const dist = distanceBetween({ x: 1, y: 2, z: 2 }, { x: 4, y: 6, z: 2 });
    expect(dist).toBeCloseTo(5, 6);
  });
});
