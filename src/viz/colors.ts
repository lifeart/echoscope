import { clamp } from '../utils.js';

export function traceColorFromConfidence(conf: number): string {
  const c = clamp(conf, 0, 1);
  const hue = 35 * (1 - c);
  return `hsla(${hue}, 96%, 62%, 0.95)`;
}

export function heatmapGrayscale(value: number): [number, number, number] {
  const g = Math.floor(255 * clamp(value, 0, 1));
  return [g, g, g];
}
