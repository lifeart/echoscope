import { fuseBandResults, getSelectedBandResult } from '../../src/calibration/band-fusion.js';
import type { BandCalibrationResult } from '../../src/types.js';

function mkBand(overrides: Partial<BandCalibrationResult> & { bandId: string }): BandCalibrationResult {
  return {
    bandHz: [900, 2500],
    valid: true,
    quality: 0.7,
    angleReliable: true,
    pilotTau: 0.005,
    pilotMAD: 0.0001,
    pilotClusterSize: 6,
    pilotAboveFloor: true,
    pilotWin: 0.0004,
    repeatClusterSize: 3,
    softFilteredCount: 0,
    deltaConsistency: 0.1,
    maxDeltaDev: 0.2,
    corrQualOk: true,
    tauMeasured: { L: 0.005, R: 0.0052 },
    tauMAD: { L: 0.0001, R: 0.0001 },
    peaks: { L: 0.8, R: 0.75 },
    deltaTau: 0.0002,
    monoLikely: false,
    ...overrides,
  };
}

describe('fuseBandResults', () => {
  it('returns fallback for empty input', () => {
    const info = fuseBandResults([]);
    expect(info.selectedBand).toBe('');
    expect(info.selectionReason).toBe('fallback');
    expect(info.bandAgreementCount).toBe(0);
  });

  it('returns only-valid for single band', () => {
    const info = fuseBandResults([mkBand({ bandId: 'M' })]);
    expect(info.selectedBand).toBe('M');
    expect(info.selectionReason).toBe('only-valid');
    expect(info.bandAgreementCount).toBe(1);
  });

  it('returns fallback for single invalid band', () => {
    const info = fuseBandResults([mkBand({ bandId: 'M', valid: false })]);
    expect(info.selectedBand).toBe('M');
    expect(info.selectionReason).toBe('fallback');
  });

  it('selects by agreement when two bands agree on pilotTau', () => {
    const bands = [
      mkBand({ bandId: 'M', pilotTau: 0.005, quality: 0.6 }),
      mkBand({ bandId: 'H', pilotTau: 0.00505, quality: 0.8 }),  // within 0.5ms
    ];
    const info = fuseBandResults(bands);
    expect(info.selectionReason).toBe('agreement');
    expect(info.bandAgreementCount).toBe(2);
    expect(info.selectedBand).toBe('H'); // higher quality within agreement group
  });

  it('selects best-quality when bands disagree', () => {
    const bands = [
      mkBand({ bandId: 'M', pilotTau: 0.003, quality: 0.9 }),
      mkBand({ bandId: 'H', pilotTau: 0.010, quality: 0.6 }), // far apart (7ms)
    ];
    const info = fuseBandResults(bands);
    expect(info.selectionReason).toBe('best-quality');
    expect(info.selectedBand).toBe('M');
    expect(info.bandAgreementCount).toBe(1);
  });

  it('falls back to best quality when no candidate passes gates', () => {
    const bands = [
      mkBand({ bandId: 'M', valid: false, quality: 0.3 }),
      mkBand({ bandId: 'H', valid: false, quality: 0.5 }),
    ];
    const info = fuseBandResults(bands);
    expect(info.selectionReason).toBe('fallback');
    expect(info.selectedBand).toBe('H');
    expect(info.bandAgreementCount).toBe(0);
  });

  it('returns only-valid when just one band passes gates', () => {
    const bands = [
      mkBand({ bandId: 'M', valid: true, corrQualOk: true, repeatClusterSize: 3 }),
      mkBand({ bandId: 'H', valid: false, corrQualOk: false, repeatClusterSize: 1 }),
    ];
    const info = fuseBandResults(bands);
    expect(info.selectionReason).toBe('only-valid');
    expect(info.selectedBand).toBe('M');
    expect(info.bandAgreementCount).toBe(1);
  });

  it('prefers angleReliable band in scoring', () => {
    const bands = [
      mkBand({ bandId: 'M', pilotTau: 0.003, quality: 0.65, angleReliable: true }),
      mkBand({ bandId: 'H', pilotTau: 0.010, quality: 0.70, angleReliable: false }),
    ];
    const info = fuseBandResults(bands);
    // M has angleReliable bonus (+1.0) which can outweigh small quality difference
    expect(info.selectedBand).toBe('M');
  });

  it('penalizes bands with soft-filter events', () => {
    const bands = [
      mkBand({ bandId: 'M', pilotTau: 0.003, quality: 0.7, softFilteredCount: 0 }),
      mkBand({ bandId: 'H', pilotTau: 0.010, quality: 0.72, softFilteredCount: 3 }),
    ];
    const info = fuseBandResults(bands);
    expect(info.selectedBand).toBe('M');
  });

  it('includes all band results in output', () => {
    const bands = [mkBand({ bandId: 'M' }), mkBand({ bandId: 'H' })];
    const info = fuseBandResults(bands);
    expect(info.bandResults).toHaveLength(2);
    expect(info.bandResults[0].bandId).toBe('M');
    expect(info.bandResults[1].bandId).toBe('H');
  });
});

describe('getSelectedBandResult', () => {
  it('returns the selected band result', () => {
    const bands = [mkBand({ bandId: 'M' }), mkBand({ bandId: 'H' })];
    const info = fuseBandResults(bands);
    const sel = getSelectedBandResult(info);
    expect(sel).toBeDefined();
    expect(sel!.bandId).toBe(info.selectedBand);
  });

  it('returns undefined for empty selection', () => {
    const info = fuseBandResults([]);
    const sel = getSelectedBandResult(info);
    expect(sel).toBeUndefined();
  });
});
