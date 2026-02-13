# Synthetic Aperture (SAFT/DAS) — Virtual Array Extension Plan

## Feature Goal

Improve angular resolution by coherently combining measurements from neighboring steering angles.

Target outcome:
- Preserve existing scan behavior when feature is disabled.
- When enabled, sharpen angle resolution by approximately **2–4×** on single-target scenes.
- Keep runtime overhead small enough for interactive scan UX on laptop-class devices.

---

## Current Pipeline (as implemented)

- `scan-engine` sweeps angles and currently aggregates only per-angle range-profile bins into heatmap rows.
- `ping-cycle` already computes raw correlation per ping and stores only the latest one in store (`lastProfile.corr`), but scan does not keep a per-angle raw buffer.
- `heatmap-data` supports row updates and pass averaging only in profile space (incoherent averaging).

Implication: we already have most plumbing for range profiles, but we need a raw-correlation cache + SAFT post-processor stage before final heatmap row selection.

---

## Proposed Design

## 1) Data capture per steering angle (new)

For each scan angle index `j`, persist a `RawAngleFrame` object in scan-local memory:

- `angleDeg`
- `sampleRate`
- `tau0`
- `corrReal: Float32Array`
- `corrImag: Float32Array` (analytic/complex companion for coherent summation)
- Optional metadata: `probeType`, `centerFreqHz`, `snrLike`/quality value

Notes:
- Keep this buffer local to `doScan()` (not in global store) to avoid bloating app state.
- For `scanPasses > 1`, coherently average passes at correlation level per angle first, then run SAFT across angles.

## 2) Correlation output upgrade (new)

Extend correlation path to expose complex form:
- Add a complex FFT-correlation API (or analytic conversion helper) that returns both real and imaginary arrays.
- Keep existing `fftCorrelate()` API for compatibility; add a parallel function for SAFT path.

Why: coherent summation requires phase-aware values, not absolute magnitude profiles.

## 3) SAFT/DAS post-process stage (new)

After full angle sweep raw capture, compute a SAFT-enhanced heatmap:

For each target cell `(rangeBin r, angleRow j)`:

1. Define neighborhood `k in [j-M, j+M]`.
2. Compute expected delay offset `Δτ(j,k,r)` from steering geometry model.
3. Sample complex correlation from frame `k` at shifted lag `τ(r) + Δτ` (fractional interpolation).
4. Apply phase compensation `exp(-i·2π·f_c·Δτ)`.
5. Apply aperture taper/window weight `w(j,k)` (Hann/Tukey/Gaussian).
6. Sum complex contributions coherently:
   - `S(r,j) = Σ w(j,k) · C_k(τ(r)+Δτ) · exp(-i2πf_cΔτ)`
7. Output intensity `I(r,j) = |S(r,j)|` and use this as the heatmap row value.

Fallback behavior:
- If coherence is low, optionally blend toward incoherent power sum (`Σ|C|`) for robustness.

## 4) Heatmap integration strategy

- Build SAFT image in one shot after scan completes (MVP):
  - Keeps control flow simple.
  - Produces deterministic output per scan.
- Optional v2: progressive SAFT updates as soon as enough neighbor rows exist.

---

## Implementation Phases

## Phase A — Types and Config

Add config block:
- `virtualArray.enabled` (boolean, default false)
- `virtualArray.halfWindow` (int, e.g. 2–6)
- `virtualArray.window` (`hann` | `gaussian`)
- `virtualArray.phaseCenterHz` (number or `auto` from probe)
- `virtualArray.coherenceFloor` (0..1)
- `virtualArray.maxTauShiftSamples` (guardrail)

Add scan-internal types:
- `RawAngleFrame`
- `SaftConfig`

## Phase B — Raw capture path

- Introduce `doPingDetailed()` (or similar) returning both `RangeProfile` and raw complex correlation metadata.
- Keep existing `doPing()` wrapper to avoid broad callsite churn.
- Update `scan-engine` to collect `RawAngleFrame[]` during sweep.

## Phase C — SAFT core module

Create `src/scan/saft.ts` with pure functions:
- `computeExpectedTauShift(...)`
- `interpolateComplexAt(...)`
- `coherentSumCell(...)`
- `buildSaftHeatmap(rawFrames, scanAngles, rangeAxis, cfg)`

Design constraints:
- No DOM/store usage in this module.
- Deterministic and test-friendly.

## Phase D — Scan pipeline wiring

- In `doScan()`, if SAFT enabled and enough angle rows exist:
  - Run SAFT post-process once after acquisition.
  - Write SAFT intensity rows via existing heatmap structure (`updateHeatmapRow` or direct fill utility).
  - Recompute best-bin/best-val per row from SAFT output.
- If disabled (or if guardrails fail), use current pipeline unchanged.

## Phase E — UI controls

Add minimal controls near scan settings:
- Enable checkbox
- Aperture half-window
- Window type
- Coherence floor

Hook controls in `readConfigFromDOM()` and preserve current defaults when feature is off.

## Phase F — Tests

Add focused tests:

1. `tests/scan/saft.test.ts`
   - Correct complex interpolation at fractional lag.
   - Phase compensation direction/sign correctness.
   - Window weighting behavior and edge handling.

2. Synthetic point-target scenario
   - Generate angle-indexed complex echoes with known steering phase law.
   - Assert SAFT peak angular width is narrower than baseline (target >=2× narrowing in synthetic fixture).

3. Integration regression
   - SAFT disabled => exact match with current heatmap pipeline.
   - SAFT enabled + low coherence => stable bounded output (no NaN/Inf, no index overruns).

---

## Performance and Memory Budget

- Time complexity target: `O(A * R * (2M+1))`
  - Typical: `A≈41`, `R≈240`, `M≈3` → ~69k cell-contributions (lightweight in JS with typed arrays).
- Memory target:
  - Raw complex cache stays scan-local and released after scan complete.
- Add micro-timing logs around SAFT step and keep below ~30–50 ms for typical settings on modern laptops.

---

## Risks and Mitigations

1. **Phase model mismatch across probes/bands**
   - Mitigate with `phaseCenterHz` tuning and coherence-gated blending.

2. **Broadband probe ambiguity (chirp/golay)**
   - Start with center-frequency phase compensation; later option: multi-band SAFT accumulation.

3. **Edge artifacts at angle boundaries**
   - Normalize by sum of active weights and handle truncated neighborhoods.

4. **Over-sharpening / sidelobes**
   - Use taper windows (Hann/Gaussian), coherence floor, and optional cap on gain.

---

## Acceptance Criteria (Definition of Done)

1. Functional
- Per-angle raw correlation data is captured across the scan (not only final profile).
- SAFT post-process runs on collected frames and produces heatmap output.
- Feature is toggleable and defaults to off.

2. Quality
- In synthetic controlled tests, angular mainlobe width improves by >=2×.
- In real scans, qualitative sharpening is visible without unstable artifacts.
- No regression when SAFT is disabled.

3. Reliability
- Unit + integration tests pass.
- No runtime exceptions/NaNs under normal scan ranges and settings.

---

## Recommended Delivery Order

1. Phase A + B (capture plumbing)
2. Phase C (pure SAFT core + unit tests)
3. Phase D (scan integration)
4. Phase E (minimal UI)
5. Phase F (synthetic sharpening benchmark + regressions)

This order keeps risk low by validating math in isolation before touching user-facing scan behavior.
