import type { ProbeConfig, ProbeSignal } from '../types.js';
import { genChirp } from './chirp.js';
import { genMLSChipped } from './mls.js';
import { genGolayChipped } from './golay.js';

export function createProbe(config: ProbeConfig, sampleRate: number): ProbeSignal {
  switch (config.type) {
    case 'chirp':
      return { type: 'chirp', ref: genChirp(config.params, sampleRate) };
    case 'mls':
      return { type: 'mls', ref: genMLSChipped(config.params, sampleRate) };
    case 'golay': {
      const { a, b } = genGolayChipped(config.params, sampleRate);
      return { type: 'golay', a, b, gapMs: config.params.gapMs };
    }
  }
}
