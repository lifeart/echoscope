import { describe, it, expect } from 'vitest';
import { Store } from '../../src/core/store.js';
import { computeDerivedConfig } from '../../src/ui/controls.js';

describe('store default config consistency', () => {
  it('listenMs matches computeDerivedConfig for default temperature/maxRange/spacing', () => {
    const store = new Store();
    const config = store.get().config;
    const derived = computeDerivedConfig(config.temperature, config.maxRange, config.spacing);
    expect(config.listenMs).toBeCloseTo(derived.listenMs, 5);
  });

  it('scanDwell matches computeDerivedConfig for default temperature/maxRange/spacing', () => {
    const store = new Store();
    const config = store.get().config;
    const derived = computeDerivedConfig(config.temperature, config.maxRange, config.spacing);
    expect(config.scanDwell).toBeCloseTo(derived.scanDwell, 5);
  });

  it('minRange matches computeDerivedConfig for default spacing', () => {
    const store = new Store();
    const config = store.get().config;
    const derived = computeDerivedConfig(config.temperature, config.maxRange, config.spacing);
    expect(config.minRange).toBe(derived.minRange);
  });

  it('speedOfSound matches computeDerivedConfig for default temperature', () => {
    const store = new Store();
    const config = store.get().config;
    const derived = computeDerivedConfig(config.temperature, config.maxRange, config.spacing);
    expect(config.speedOfSound).toBeCloseTo(derived.speedOfSound, 5);
  });

  it('default temperature is 25', () => {
    const store = new Store();
    expect(store.get().config.temperature).toBe(25);
  });

  it('default captureTimeoutMs is 300', () => {
    const store = new Store();
    expect(store.get().config.distributed.captureTimeoutMs).toBe(300);
  });
});
