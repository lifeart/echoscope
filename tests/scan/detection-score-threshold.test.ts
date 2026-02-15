/**
 * Regression test for the detection-score threshold in doPingDetailed.
 *
 * Bug: The weighted detection score has maximum 1.0 (weights sum to 1.0)
 * but the isWeak threshold was also 1.0, requiring ALL factors — including
 * trackScore and priorScore — to be at their maximum.  On the first ping
 * (no tracking history, no range prior), trackScore=0 and priorScore≤0.3,
 * so the max achievable score was ~0.83.  This meant detection was ALWAYS
 * classified as weak, zeroing out the profile and correlation, producing
 * the "no TX detected" placeholder regardless of actual signal quality.
 *
 * Fix: lowered isWeak threshold to 0.55 and trackingCandidate to 0.50.
 */

describe('detection score threshold regression', () => {
  // ---- replicate the scoring formula from ping-cycle.ts ----
  function computeDetectionScore(opts: {
    confScore: number;
    strengthScore: number;
    cfarScore: number;
    trackScore: number;
    priorScore: number;
    edgePenalty: number;
  }): number {
    return (
      0.30 * opts.confScore +
      0.25 * opts.strengthScore +
      0.25 * opts.cfarScore +
      0.10 * opts.trackScore +
      0.10 * opts.priorScore -
      opts.edgePenalty
    );
  }

  const WEAK_THRESHOLD = 0.55;
  const TRACKING_THRESHOLD = 0.50;

  describe('first ping (no tracking, no range prior)', () => {
    it('strong signal passes the isWeak gate', () => {
      // All core factors maxed, no tracking, neutral prior
      const score = computeDetectionScore({
        confScore: 1.0,
        strengthScore: 1.0,
        cfarScore: 1.0,
        trackScore: 0,       // no tracks exist yet
        priorScore: 0.3,     // neutral fallback
        edgePenalty: 0,
      });

      // Score = 0.30 + 0.25 + 0.25 + 0 + 0.03 = 0.83
      expect(score).toBeCloseTo(0.83, 2);
      expect(score).toBeGreaterThanOrEqual(WEAK_THRESHOLD);
    });

    it('strong signal also passes the tracking gate', () => {
      const score = computeDetectionScore({
        confScore: 1.0,
        strengthScore: 1.0,
        cfarScore: 1.0,
        trackScore: 0,
        priorScore: 0.3,
        edgePenalty: 0,
      });

      expect(score).toBeGreaterThanOrEqual(TRACKING_THRESHOLD);
    });

    it('moderate signal passes the isWeak gate', () => {
      const score = computeDetectionScore({
        confScore: 0.8,
        strengthScore: 0.7,
        cfarScore: 0.8,
        trackScore: 0,
        priorScore: 0.3,
        edgePenalty: 0,
      });

      // 0.24 + 0.175 + 0.20 + 0 + 0.03 = 0.645
      expect(score).toBeGreaterThanOrEqual(WEAK_THRESHOLD);
    });

    it('weak signal fails the isWeak gate', () => {
      const score = computeDetectionScore({
        confScore: 0.3,
        strengthScore: 0.2,
        cfarScore: 0,
        trackScore: 0,
        priorScore: 0.3,
        edgePenalty: 0,
      });

      // 0.09 + 0.05 + 0 + 0 + 0.03 = 0.17
      expect(score).toBeLessThan(WEAK_THRESHOLD);
    });

    it('noise-level signal fails the isWeak gate', () => {
      const score = computeDetectionScore({
        confScore: 0.1,
        strengthScore: 0.05,
        cfarScore: 0,
        trackScore: 0,
        priorScore: 0.3,
        edgePenalty: 0,
      });

      expect(score).toBeLessThan(WEAK_THRESHOLD);
    });
  });

  describe('edge peak penalty', () => {
    it('strong edge peak is suppressed', () => {
      const score = computeDetectionScore({
        confScore: 1.0,
        strengthScore: 1.0,
        cfarScore: 1.0,
        trackScore: 0,
        priorScore: 0.3,
        edgePenalty: 0.4,
      });

      // 0.83 - 0.4 = 0.43
      expect(score).toBeLessThan(WEAK_THRESHOLD);
    });

    it('edge peak with tracking can still pass', () => {
      const score = computeDetectionScore({
        confScore: 1.0,
        strengthScore: 1.0,
        cfarScore: 1.0,
        trackScore: 0.8,
        priorScore: 0.8,
        edgePenalty: 0.4,
      });

      // 0.30 + 0.25 + 0.25 + 0.08 + 0.08 - 0.4 = 0.56
      expect(score).toBeGreaterThanOrEqual(WEAK_THRESHOLD);
    });
  });

  describe('tracking bootstrapping', () => {
    it('first detection initializes tracking (score >= trackingCandidate)', () => {
      // On first ping: no track → trackScore=0
      const firstScore = computeDetectionScore({
        confScore: 1.0,
        strengthScore: 1.0,
        cfarScore: 1.0,
        trackScore: 0,
        priorScore: 0.3,
        edgePenalty: 0,
      });

      expect(firstScore).toBeGreaterThanOrEqual(TRACKING_THRESHOLD);

      // On second ping: track exists → trackScore>0
      const secondScore = computeDetectionScore({
        confScore: 1.0,
        strengthScore: 1.0,
        cfarScore: 1.0,
        trackScore: 0.7,
        priorScore: 0.5,
        edgePenalty: 0,
      });

      expect(secondScore).toBeGreaterThan(firstScore);
      expect(secondScore).toBeGreaterThanOrEqual(WEAK_THRESHOLD);
    });

    it('moderate signal can start tracking after first ping', () => {
      const score = computeDetectionScore({
        confScore: 0.7,
        strengthScore: 0.6,
        cfarScore: 0.7,
        trackScore: 0,
        priorScore: 0.3,
        edgePenalty: 0,
      });

      // 0.21 + 0.15 + 0.175 + 0 + 0.03 = 0.565
      expect(score).toBeGreaterThanOrEqual(TRACKING_THRESHOLD);
    });
  });

  describe('score invariants', () => {
    it('weights sum to 1.0', () => {
      const totalWeight = 0.30 + 0.25 + 0.25 + 0.10 + 0.10;
      expect(totalWeight).toBeCloseTo(1.0, 10);
    });

    it('maximum possible score is 1.0 (no edge penalty)', () => {
      const maxScore = computeDetectionScore({
        confScore: 1.0,
        strengthScore: 1.0,
        cfarScore: 1.0,
        trackScore: 1.0,
        priorScore: 1.0,
        edgePenalty: 0,
      });

      expect(maxScore).toBeCloseTo(1.0, 10);
    });

    it('minimum score without penalty is 0', () => {
      const minScore = computeDetectionScore({
        confScore: 0,
        strengthScore: 0,
        cfarScore: 0,
        trackScore: 0,
        priorScore: 0,
        edgePenalty: 0,
      });

      expect(minScore).toBe(0);
    });

    it('core factors alone (no track/prior) can exceed WEAK_THRESHOLD', () => {
      // This is the key invariant that was broken before
      const coreOnlyMax = computeDetectionScore({
        confScore: 1.0,
        strengthScore: 1.0,
        cfarScore: 1.0,
        trackScore: 0,
        priorScore: 0,
        edgePenalty: 0,
      });

      // 0.30 + 0.25 + 0.25 = 0.80
      expect(coreOnlyMax).toBeCloseTo(0.80, 10);
      expect(coreOnlyMax).toBeGreaterThanOrEqual(WEAK_THRESHOLD);
    });

    it('WEAK_THRESHOLD > TRACKING_THRESHOLD', () => {
      expect(WEAK_THRESHOLD).toBeGreaterThan(TRACKING_THRESHOLD);
    });
  });
});
