import { describe, it, expect } from 'vitest';
import { getColormapLUT, lookupLUT } from '../../src/viz/colors.js';
import type { ColormapName } from '../../src/types.js';

describe('getColormapLUT', () => {
  it('returns 768-byte Uint8Array for each colormap', () => {
    for (const name of ['grayscale', 'inferno', 'viridis'] as ColormapName[]) {
      const lut = getColormapLUT(name);
      expect(lut).toBeInstanceOf(Uint8Array);
      expect(lut.length).toBe(768);
    }
  });

  it('grayscale LUT maps i to [i,i,i]', () => {
    const lut = getColormapLUT('grayscale');

    // Index 0 -> [0, 0, 0]
    expect(lut[0]).toBe(0);
    expect(lut[1]).toBe(0);
    expect(lut[2]).toBe(0);

    // Index 128 -> [128, 128, 128]
    expect(lut[128 * 3]).toBe(128);
    expect(lut[128 * 3 + 1]).toBe(128);
    expect(lut[128 * 3 + 2]).toBe(128);

    // Index 255 -> [255, 255, 255]
    expect(lut[255 * 3]).toBe(255);
    expect(lut[255 * 3 + 1]).toBe(255);
    expect(lut[255 * 3 + 2]).toBe(255);
  });

  it('inferno starts dark, ends bright', () => {
    const lut = getColormapLUT('inferno');

    // First entry should be near [0, 0, 4]
    expect(lut[0]).toBe(0);
    expect(lut[1]).toBe(0);
    expect(lut[2]).toBe(4);

    // Last entry should be near [252, 255, 164]
    expect(lut[255 * 3]).toBeCloseTo(252, -1);
    expect(lut[255 * 3 + 1]).toBeCloseTo(255, -1);
    expect(lut[255 * 3 + 2]).toBeCloseTo(164, -1);
  });

  it('viridis has monotonic perceived luminance', () => {
    const lut = getColormapLUT('viridis');

    const luminance = (i: number) => {
      const r = lut[i * 3];
      const g = lut[i * 3 + 1];
      const b = lut[i * 3 + 2];
      return 0.299 * r + 0.587 * g + 0.114 * b;
    };

    const L0 = luminance(0);
    const L128 = luminance(128);
    const L255 = luminance(255);

    // Luminance should increase: L0 < L128 < L255
    expect(L128).toBeGreaterThan(L0);
    expect(L255).toBeGreaterThan(L128);
  });

  it('fallback to grayscale for unknown name', () => {
    const unknown = getColormapLUT('nonexistent' as ColormapName);
    const grayscale = getColormapLUT('grayscale');

    expect(unknown.length).toBe(768);
    // Should produce the same LUT as grayscale
    for (let i = 0; i < 768; i++) {
      expect(unknown[i]).toBe(grayscale[i]);
    }
  });
});

describe('lookupLUT', () => {
  it('maps 0 to first entry, 1 to last entry', () => {
    const lut = getColormapLUT('grayscale');

    const first = lookupLUT(lut, 0);
    expect(first).toEqual([0, 0, 0]);

    const last = lookupLUT(lut, 1);
    expect(last).toEqual([255, 255, 255]);
  });

  it('clamps out-of-range values', () => {
    const lut = getColormapLUT('grayscale');

    // Negative value should clamp to first entry
    const neg = lookupLUT(lut, -0.5);
    expect(neg).toEqual([0, 0, 0]);

    // Value > 1 should clamp to last entry
    const over = lookupLUT(lut, 1.5);
    expect(over).toEqual([255, 255, 255]);
  });
});
