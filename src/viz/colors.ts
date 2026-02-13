import { clamp } from '../utils.js';
import type { ColormapName } from '../types.js';

export type ColormapLUT = Uint8Array; // 256×3 = 768 entries

export function traceColorFromConfidence(conf: number): string {
  const c = clamp(conf, 0, 1);
  const hue = 35 * (1 - c);
  return `hsla(${hue}, 96%, 62%, 0.95)`;
}

export function heatmapGrayscale(value: number): [number, number, number] {
  const g = Math.floor(255 * clamp(value, 0, 1));
  return [g, g, g];
}

// 9 control points per colormap [r, g, b] at positions 0..8 (mapped to 0..255)
const INFERNO_POINTS: [number, number, number][] = [
  [0, 0, 4],
  [22, 11, 57],
  [66, 10, 104],
  [120, 28, 109],
  [165, 44, 96],
  [207, 68, 70],
  [237, 105, 37],
  [251, 175, 35],
  [252, 255, 164],
];

const VIRIDIS_POINTS: [number, number, number][] = [
  [68, 1, 84],
  [72, 35, 116],
  [64, 67, 135],
  [52, 94, 141],
  [33, 121, 140],
  [33, 148, 140],
  [53, 183, 121],
  [109, 205, 89],
  [253, 231, 37],
];

function interpolateControlPoints(points: [number, number, number][]): ColormapLUT {
  const lut = new Uint8Array(768);
  const n = points.length - 1;
  for (let i = 0; i < 256; i++) {
    const pos = (i / 255) * n;
    const idx0 = Math.min(Math.floor(pos), n - 1);
    const idx1 = idx0 + 1;
    const frac = pos - idx0;
    const r = points[idx0][0] + (points[idx1][0] - points[idx0][0]) * frac;
    const g = points[idx0][1] + (points[idx1][1] - points[idx0][1]) * frac;
    const b = points[idx0][2] + (points[idx1][2] - points[idx0][2]) * frac;
    lut[i * 3] = clamp(Math.round(r), 0, 255);
    lut[i * 3 + 1] = clamp(Math.round(g), 0, 255);
    lut[i * 3 + 2] = clamp(Math.round(b), 0, 255);
  }
  return lut;
}

function buildGrayscaleLUT(): ColormapLUT {
  const lut = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    lut[i * 3] = i;
    lut[i * 3 + 1] = i;
    lut[i * 3 + 2] = i;
  }
  return lut;
}

// Cache LUTs at module level
const lutCache = new Map<ColormapName, ColormapLUT>();

export function getColormapLUT(name: ColormapName): ColormapLUT {
  let lut = lutCache.get(name);
  if (lut) return lut;

  switch (name) {
    case 'inferno':
      lut = interpolateControlPoints(INFERNO_POINTS);
      break;
    case 'viridis':
      lut = interpolateControlPoints(VIRIDIS_POINTS);
      break;
    case 'grayscale':
    default:
      lut = buildGrayscaleLUT();
      break;
  }

  lutCache.set(name, lut);
  return lut;
}

export function lookupLUT(lut: ColormapLUT, value: number): [number, number, number] {
  const idx = clamp(Math.floor(clamp(value, 0, 1) * 255), 0, 255) * 3;
  return [lut[idx], lut[idx + 1], lut[idx + 2]];
}
