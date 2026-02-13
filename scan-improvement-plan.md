# Echoscope Scan Improvement Plan

Date: 2026-02-13
Owner: Scan pipeline (scan + dsp + calibration integration)

## 1) Objective

Improve weak-target detection, angular stability, and cross-device robustness in the scan pipeline while preserving current SAFT and beamforming paths.

Primary outcomes:
- Increase usable SNR per angle with robust multiping integration (target: +3–9 dB equivalent gain in weak scenes).
- Reduce false direction picks from single-row outliers.
- Prevent over-subtraction and background learning of real targets.
- Make `qualityAlgo=auto` truly adaptive to scene conditions.

## 2) Current Baseline (from code audit)

Already present:
- Multipass scanning (`scanPasses`) with arithmetic averaging in `src/scan/scan-engine.ts` and `src/scan/heatmap-data.ts`.
- RX beamforming in scan ping path (`delayAndSum`) in `src/scan/ping-cycle.ts`.
- Stereo mic request in `src/audio/engine.ts` (`channelCount: 2`).
- SAFT post-focusing in `src/scan/saft.ts` integrated by `applySaftHeatmapIfEnabled`.

Main weaknesses:
- Global amplitude gating (`bestVal` vs one `strengthGate`) is brittle.
- Final angle is winner-takes-all by strongest row.
- `auto` quality resolves to fixed `balanced`.
- Display IIR exists, but data-layer temporal accumulation is missing.
- No per-angle profile history/outlier rejection in scan.
- Clutter/env subtraction has limited self-protection and non-selective model updates.

## 3) Scope

In scope:
1. Adaptive confidence gating (replace fixed amplitude gate as primary criterion).
2. Neighborhood consensus angle selection.
3. Robust multiping integration per angle.
4. Temporal IIR in data path.
5. Per-angle outlier rejection.
6. Adaptive quality auto mode.
7. Self-limiting env baseline + clutter subtraction.
8. Selective clutter-model updates.
9. Angular continuity checks.

Out of scope for this cycle (tracked as stretch):
- Full MVDR/Capon beamformer.
- Full beam-pattern deconvolution pipeline.
- Per-band steering/fusion rewrite.

## 4) Architecture Additions

### 4.1 Row confidence model (new)

For each angle row, compute:
- `psr`: peak-to-local-floor ratio.
- `sharpness`: local curvature/width at peak.
- `sidelobeRatio`: main peak energy vs side-lobe energy.

Confidence score:

`confidence = w1*norm(psr) + w2*norm(sharpness) + w3*norm(sidelobeRatio)`

Use confidence gate as primary acceptance condition:
- `confidence >= confidenceGate`
- keep `strengthGate` only as a low-level sanity floor.

### 4.2 Consensus direction selector (new)

Replace global max row with:
1. 3-row smoothing of row confidence (or row score).
2. continuity check in `bestBin` across neighbors.
3. neighborhood consensus winner selection.

### 4.3 Multiping robust aggregation (upgrade)

Add `scanAggregateMode`:
- `mean` (compat), `median`, `trimmedMean`.

Default for weak scenes: `trimmedMean` (trim 20%).

### 4.4 Temporal IIR feedback into data array (new)

Apply IIR to `heatmap.data` update path (not only `display`):
- `data = (1-alpha)*data + alpha*rowMeasurement`
- compute row best from integrated row.

### 4.5 Per-angle outlier rejection history (new)

Store last `N` row profiles per angle (`N=5..9`):
- cluster by profile similarity or peak-bin consistency,
- reject spike outliers before committing row update.

### 4.6 Adaptive quality auto resolver (upgrade)

Resolve `fast|balanced|max` based on measured scene quality:
- low SNR/PSR => `max`
- medium => `balanced`
- high SNR => `fast`

Use hysteresis and minimum dwell to prevent mode flapping.

### 4.7 Self-limiting subtraction + selective clutter updates (upgrade)

Env baseline and clutter subtraction backoff when:
- collapse ratio too high,
- peak drops too sharply after subtraction.

Update clutter model only for:
- low-confidence bins, or
- bins without motion/novelty evidence.

## 5) Implementation Phases

## Phase P0 (must-have stability)

1. Adaptive confidence gating.
2. Neighborhood consensus selector.
3. Self-limiting subtraction + selective clutter update.

Files:
- `src/scan/ping-cycle.ts`
- `src/scan/scan-engine.ts`
- `src/dsp/clutter.ts`
- `src/types.ts`, `src/core/store.ts`, `src/ui/controls.ts`

Acceptance:
- Single-row amplitude spikes no longer dominate final direction.
- Over-subtraction scenarios preserve detectable peak when raw signal exists.

## Phase P1 (SNR and weak-target lift)

4. Multiping robust aggregation (`median`/`trimmedMean`).
5. Temporal IIR feedback in `heatmap.data`.
6. Per-angle outlier history and rejection.

Files:
- `src/scan/heatmap-data.ts`
- `src/scan/scan-engine.ts`
- `src/scan/ping-cycle.ts`

Acceptance:
- Weak static targets become more persistent across sweeps.
- Multiping in noisy scenes improves detection stability over mean baseline.

## Phase P2 (adaptive quality + continuity)

7. Adaptive `qualityAlgo=auto` resolver.
8. Cross-angle continuity checks across sweeps.

Files:
- `src/scan/ping-cycle.ts`
- `src/dsp/quality.ts`
- `src/scan/scan-engine.ts`

Acceptance:
- Auto mode chooses different policies in low vs high SNR scenes.
- Direction estimate remains stable under adjacent-angle coherence rules.

## Phase P3 (optional stretch)

9. Frequency-dependent steering/fusion prototype.
10. MVDR/Capon feasibility spike.
11. Beam-pattern deconvolution prototype (CLEAN/RL).

## 6) Ranked Improvement Options (Impact × Feasibility)

1. Stereo capture + TX/RX combined processing (highest impact): partial wiring exists; complete fusion path.
2. SAFT/DAS synthetic aperture: already present; improve confidence coupling and coherence policy.
3. Frequency-dependent steering refinement: medium impact, medium complexity.
4. Capon/MVDR beamforming: high potential, higher complexity and data-quality demands.
5. Beam-pattern deconvolution: post-hoc sharpening, medium-high complexity.

## 7) Config Additions

Add to app config/state:
- `confidenceGate: number`
- `scanAggregateMode: 'mean' | 'median' | 'trimmedMean'`
- `scanTrimFraction: number`
- `temporalIirAlpha: number`
- `outlierHistoryN: number`
- `continuityBins: number`
- `adaptiveQuality: { enabled: boolean; hysteresisMs: number }`
- `subtractionBackoff: { enabled: boolean; collapseThreshold: number; peakDropThreshold: number }`

## 8) Test Plan

New/updated tests:
- `tests/scan/scan-engine-consensus.test.ts`
  - outlier row should not win over coherent neighborhood.
- `tests/scan/multiping-aggregation.test.ts`
  - compare `mean` vs `median`/`trimmedMean` under injected spikes.
- `tests/scan/temporal-iir-data.test.ts`
  - weak target accumulates in `heatmap.data` over sweeps.
- `tests/dsp/clutter-self-limiting.test.ts`
  - subtraction backoff triggers on collapse/peak-drop conditions.
- `tests/scan/quality-auto-adaptive.test.ts`
  - auto mode resolves to `max`, `balanced`, `fast` in expected scenes.
- `tests/scan/angular-continuity.test.ts`
  - continuity rejects isolated angle anomalies.

Keep existing regressions passing:
- `tests/scan/scan-engine-saft-regression.test.ts`
- `tests/scan/heatmap-pipeline.test.ts`
- `tests/scan/beamform-integration.test.ts`

## 9) Rollout Strategy

- Stage 1: ship P0 behind feature flags, default off.
- Stage 2: enable P0 defaults after regression pass and manual room tests.
- Stage 3: ship P1 with conservative defaults (`trimmedMean`, low `temporalIirAlpha`).
- Stage 4: enable adaptive auto quality once hysteresis behavior is validated.

## 10) Risks and Mitigations

- Risk: Over-smoothing hides fast movers.
  - Mitigation: SNR-conditioned smoothing + fast-mode fallback.

- Risk: Added complexity causes parameter instability.
  - Mitigation: bounded config ranges, safe defaults, and staged rollout.

- Risk: Clutter backoff too permissive reintroduces noise floor.
  - Mitigation: dual criteria (collapse + peak retention) and min/max clamps.

## 11) Definition of Done

Done when all are true:
1. P0+P1+P2 features implemented with tests.
2. Existing scan/SAFT regressions pass.
3. Weak-target benchmark scenes show improved stability and fewer false angle jumps.
4. No significant performance regressions in typical scan loop timing.
