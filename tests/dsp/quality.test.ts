import {
  median3Profile,
  triSmoothProfile,
  adaptiveFloorSuppressProfile,
  applyQualityAlgorithms,
} from '../../src/dsp/quality.js';

describe('median3Profile', () => {
  it('preserves length', () => {
    const src = new Float32Array([1, 5, 2, 8, 3]);
    const out = median3Profile(src);
    expect(out.length).toBe(5);
  });

  it('returns median of each 3-element window', () => {
    const src = new Float32Array([1, 5, 2, 8, 3]);
    const out = median3Profile(src);
    // Edges are copied: out[0]=1, out[4]=3
    expect(out[0]).toBe(1);
    expect(out[4]).toBe(3);
    // Inner: median(1,5,2)=2, median(5,2,8)=5, median(2,8,3)=3
    expect(out[1]).toBe(2);
    expect(out[2]).toBe(5);
    expect(out[3]).toBe(3);
  });

  it('removes single-sample spike', () => {
    const src = new Float32Array([0.1, 0.1, 1.0, 0.1, 0.1]);
    const out = median3Profile(src);
    // The spike at index 2: median(0.1, 1.0, 0.1) = 0.1
    expect(out[2]).toBeCloseTo(0.1);
  });

  it('preserves plateau', () => {
    const src = new Float32Array([0, 0.5, 0.5, 0.5, 0]);
    const out = median3Profile(src);
    expect(out[1]).toBeCloseTo(0.5);
    expect(out[2]).toBeCloseTo(0.5);
    expect(out[3]).toBeCloseTo(0.5);
  });

  it('handles empty array', () => {
    const out = median3Profile(new Float32Array(0));
    expect(out.length).toBe(0);
  });

  it('handles single element', () => {
    const out = median3Profile(new Float32Array([7]));
    expect(out[0]).toBe(7);
  });
});

describe('triSmoothProfile', () => {
  it('preserves length', () => {
    const src = new Float32Array([1, 2, 3, 4, 5]);
    expect(triSmoothProfile(src).length).toBe(5);
  });

  it('applies [0.25, 0.5, 0.25] kernel', () => {
    const src = new Float32Array([0, 0, 1, 0, 0]);
    const out = triSmoothProfile(src);
    // out[1] = 0.25*0 + 0.5*0 + 0.25*1 = 0.25
    expect(out[1]).toBeCloseTo(0.25);
    // out[2] = 0.25*0 + 0.5*1 + 0.25*0 = 0.5
    expect(out[2]).toBeCloseTo(0.5);
    // out[3] = 0.25*1 + 0.5*0 + 0.25*0 = 0.25
    expect(out[3]).toBeCloseTo(0.25);
    // Edges preserved
    expect(out[0]).toBe(0);
    expect(out[4]).toBe(0);
  });

  it('preserves DC level', () => {
    const src = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5]);
    const out = triSmoothProfile(src);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBeCloseTo(0.5);
    }
  });

  it('does not create new array for empty input', () => {
    const out = triSmoothProfile(new Float32Array(0));
    expect(out.length).toBe(0);
  });
});

describe('adaptiveFloorSuppressProfile', () => {
  it('preserves length', () => {
    const src = new Float32Array(20);
    expect(adaptiveFloorSuppressProfile(src).length).toBe(20);
  });

  it('suppresses uniform noise floor', () => {
    // Uniform signal should be mostly suppressed
    const src = new Float32Array(20).fill(0.5);
    const out = adaptiveFloorSuppressProfile(src);
    // At center: mean of 9 neighbors = 0.5, floor = 0.5, v = 0.5 - 0.9*0.5 = 0.05
    for (let i = 4; i < 16; i++) {
      expect(out[i]).toBeCloseTo(0.05, 1);
    }
  });

  it('preserves isolated peak above floor', () => {
    const src = new Float32Array(20).fill(0);
    src[10] = 1.0;
    const out = adaptiveFloorSuppressProfile(src);
    // At bin 10: mean of 9 neighbors = 1/9 ≈ 0.111, floor = 0.111
    // v = 1.0 - 0.9 * 0.111 ≈ 0.9
    expect(out[10]).toBeGreaterThan(0.85);
    // Neighbors should be 0 (below floor after subtraction)
    expect(out[8]).toBe(0);
    expect(out[12]).toBe(0);
  });

  it('clamps negative values to zero', () => {
    const src = new Float32Array([0.1, 0.1, 0.1, 0.1, 0.1]);
    const out = adaptiveFloorSuppressProfile(src);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('applyQualityAlgorithms', () => {
  it('fast mode returns input unchanged', () => {
    const src = new Float32Array([0.1, 0.5, 0.9, 0.3]);
    const out = applyQualityAlgorithms(src, 'fast');
    expect(out).toBe(src); // same reference
  });

  it('balanced mode applies median + smooth without normalization', () => {
    const src = new Float32Array(20).fill(0);
    src[10] = 0.8;
    const out = applyQualityAlgorithms(src, 'balanced');
    expect(out.length).toBe(20);
    // Peak should be reduced but not normalized to 1.0
    let maxVal = 0;
    for (let i = 0; i < out.length; i++) {
      if (out[i] > maxVal) maxVal = out[i];
    }
    // After median3, single-sample spike is removed (median of 0, 0.8, 0 = 0)
    // So balanced mode should remove single-sample spikes
    expect(maxVal).toBeLessThan(0.8);
  });

  it('balanced mode preserves wide peaks', () => {
    const src = new Float32Array(20).fill(0);
    src[9] = 0.5;
    src[10] = 0.8;
    src[11] = 0.5;
    const out = applyQualityAlgorithms(src, 'balanced');
    let maxVal = 0;
    for (let i = 0; i < out.length; i++) {
      if (out[i] > maxVal) maxVal = out[i];
    }
    // Wide peak survives median + smooth
    expect(maxVal).toBeGreaterThan(0.3);
  });

  it('max mode suppresses noise floor', () => {
    // Uniform noise with one peak
    const src = new Float32Array(40).fill(0.1);
    src[20] = 0.9;
    src[19] = 0.4;
    src[21] = 0.4;
    const out = applyQualityAlgorithms(src, 'max');
    // The peak should be prominent; the noise floor should be suppressed
    const peakVal = Math.max(out[19], out[20], out[21]);
    const floorVal = out[5]; // well away from peak
    expect(peakVal).toBeGreaterThan(floorVal * 3);
  });

  it('does not normalize output to max=1', () => {
    const src = new Float32Array(20).fill(0);
    src[9] = 0.3;
    src[10] = 0.5;
    src[11] = 0.3;
    const out = applyQualityAlgorithms(src, 'balanced');
    let maxVal = 0;
    for (let i = 0; i < out.length; i++) {
      if (out[i] > maxVal) maxVal = out[i];
    }
    // The max should NOT be normalized to 1.0
    expect(maxVal).toBeLessThan(1.0);
    expect(maxVal).toBeGreaterThan(0);
  });
});
