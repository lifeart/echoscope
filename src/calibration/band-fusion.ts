import { MULTIBAND_AGREE_WIN } from '../constants.js';
import type { BandCalibrationResult, MultibandInfo } from '../types.js';

/**
 * Cross-band fusion: select the best band result or fuse multiple
 * band results into a single calibration answer.
 *
 * Strategy (from the plan):
 *   1. Filter to candidate bands (valid + corrQualOk + cluster >= 2)
 *   2. Check mode agreement (pilotTau proximity)
 *   3. Score remaining candidates
 *   4. Select best; record agreement count and reason
 */
export function fuseBandResults(bandResults: BandCalibrationResult[]): MultibandInfo {
  if (bandResults.length === 0) {
    return {
      selectedBand: '',
      bandAgreementCount: 0,
      bandResults: [],
      selectionReason: 'fallback',
    };
  }

  if (bandResults.length === 1) {
    return {
      selectedBand: bandResults[0].bandId,
      bandAgreementCount: 1,
      bandResults,
      selectionReason: bandResults[0].valid ? 'only-valid' : 'fallback',
    };
  }

  // Step 1: Candidate bands (valid + corrQualOk + repeatCluster >= 2)
  const candidates = bandResults.filter(
    b => b.valid && b.corrQualOk && b.repeatClusterSize >= 2
  );

  // Fallback: if no candidates pass, use best-quality band even if invalid
  if (candidates.length === 0) {
    const sorted = [...bandResults].sort((a, b) => b.quality - a.quality);
    return {
      selectedBand: sorted[0].bandId,
      bandAgreementCount: 0,
      bandResults,
      selectionReason: 'fallback',
    };
  }

  if (candidates.length === 1) {
    return {
      selectedBand: candidates[0].bandId,
      bandAgreementCount: 1,
      bandResults,
      selectionReason: 'only-valid',
    };
  }

  // Step 2: Mode agreement — check which bands agree on pilotTau
  const agreeWin = MULTIBAND_AGREE_WIN;
  const agreementGroups = findAgreementGroups(candidates, agreeWin);

  // If there's a group of >=2 bands that agree, prefer that mode
  const largestGroup = agreementGroups.reduce(
    (best, g) => g.length > best.length ? g : best,
    [] as BandCalibrationResult[],
  );

  if (largestGroup.length >= 2) {
    // Multiple bands agree — select best within this group
    const best = selectBestBand(largestGroup);
    return {
      selectedBand: best.bandId,
      bandAgreementCount: largestGroup.length,
      bandResults,
      selectionReason: 'agreement',
    };
  }

  // Step 3: No agreement — pick best overall score
  const best = selectBestBand(candidates);
  return {
    selectedBand: best.bandId,
    bandAgreementCount: 1,
    bandResults,
    selectionReason: 'best-quality',
  };
}

/**
 * Find groups of bands that agree on pilotTau within agreeWin.
 * Uses single-linkage clustering.
 */
function findAgreementGroups(
  bands: BandCalibrationResult[],
  agreeWin: number,
): BandCalibrationResult[][] {
  const sorted = [...bands].sort((a, b) => a.pilotTau - b.pilotTau);
  const groups: BandCalibrationResult[][] = [];
  let current: BandCalibrationResult[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    // Check if this band's pilotTau is within agreeWin of any member in current group
    const agrees = current.some(
      m => Math.abs(m.pilotTau - sorted[i].pilotTau) <= agreeWin
    );
    if (agrees) {
      current.push(sorted[i]);
    } else {
      groups.push(current);
      current = [sorted[i]];
    }
  }
  groups.push(current);
  return groups;
}

/**
 * Score and select the best band from a set of candidates.
 *
 * Scoring factors (all positive = better):
 *   - higher quality (0-1)
 *   - larger repeatClusterSize
 *   - angleReliable = true
 *   - lower pilotMAD (more stable pilot)
 *   - lower deltaConsistency (more consistent TDOA)
 *
 * Penalties:
 *   - soft-filter events
 */
function selectBestBand(candidates: BandCalibrationResult[]): BandCalibrationResult {
  if (candidates.length === 1) return candidates[0];

  const scored = candidates.map(b => ({
    band: b,
    score: computeBandScore(b),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored[0].band;
}

function computeBandScore(b: BandCalibrationResult): number {
  let score = 0;

  // Quality is the primary signal (0-1, weight 3.0)
  score += b.quality * 3.0;

  // More repeats = more reliable (weight 0.5 per repeat above 2)
  score += Math.max(0, b.repeatClusterSize - 1) * 0.5;

  // Angle reliability bonus
  if (b.angleReliable) score += 1.0;

  // Lower pilotMAD = better (invert, clamp at 1ms)
  const pilotMadMs = b.pilotMAD * 1000;
  score += Math.max(0, 1 - pilotMadMs) * 0.5;

  // Lower deltaConsistency = better
  score += Math.max(0, 1 - b.deltaConsistency) * 0.5;

  // Penalty for soft-filter events
  score -= b.softFilteredCount * 0.3;

  // Bonus for pilotAboveFloor (real acoustic mode)
  if (b.pilotAboveFloor) score += 0.5;

  return score;
}

/**
 * Get the selected band's result from a MultibandInfo.
 */
export function getSelectedBandResult(info: MultibandInfo): BandCalibrationResult | undefined {
  return info.bandResults.find(b => b.bandId === info.selectedBand);
}
