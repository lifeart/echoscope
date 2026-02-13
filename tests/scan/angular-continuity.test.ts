import { applyAngularContinuity } from '../../src/scan/scan-engine.js';

describe('angular continuity', () => {
  it('rejects large jump when candidate is not significantly stronger', () => {
    const angles = [-40, -20, 0, 20, 40];
    const scores = new Float32Array([0.2, 0.8, 0.6, 0.72, 0.75]);

    const resolved = applyAngularContinuity(4, angles, scores, -20);
    expect(resolved).toBe(1);
  });

  it('allows large jump when candidate is clearly stronger', () => {
    const angles = [-40, -20, 0, 20, 40];
    const scores = new Float32Array([0.2, 0.6, 0.4, 0.7, 1.1]);

    const resolved = applyAngularContinuity(4, angles, scores, -20);
    expect(resolved).toBe(4);
  });
});
