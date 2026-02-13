# WebRTC Improvement Plan

## Objective
Increase connection reliability in real-world networks, make peer behavior deterministic under failures, and implement true distributed calibration (not local-only fallback behavior).

## Success Metrics
- Connection success rate in constrained NAT/mobile scenarios increases significantly.
- Automatic recovery from transient disconnects works within target window.
- Control messages remain stable under channel load.
- Distributed calibration uses remote peers and improves calibration quality metrics.
- Operational diagnostics clearly explain why a peer is unavailable/degraded/excluded.

## Scope and Priorities

### P0 — Critical (Sprint 1)

#### 1) TURN-ready ICE configuration
**What to implement**
- Add configurable ICE server list with STUN + TURN (UDP/TCP/TLS).
- Support short-lived credentials rotation (token/user/pass provider).
- Add connectivity validation path for ICE config at startup.

**Acceptance criteria**
- Peers connect in at least two difficult network environments without manual workaround.
- Clear fallback behavior when TURN is unreachable.

**Suggested files**
- `src/network/rtc-transport.ts`
- `src/network/signaling.ts`
- `src/ui/app.ts` (settings wiring if needed)

---

#### 2) ICE restart and reconnect resilience
**What to implement**
- Detect `iceconnectionstate` transitions (`disconnected`, `failed`).
- Trigger `restartIce` flow with bounded exponential backoff.
- Add attempt budget and terminal degraded state.

**Acceptance criteria**
- Recovery from short network drops in ≤ 10–15s.
- No infinite restart loops.

**Suggested files**
- `src/network/peer-manager.ts`
- `src/network/rtc-transport.ts`

---

#### 3) Signaling protocol hardening
**What to implement**
- Add protocol version and message schema validation.
- Add `msgId`, `ack`, deduplication, and idempotent processing.
- Handle reordering/replay safely for offer/answer/candidates.

**Acceptance criteria**
- No duplicate-apply races when signaling messages repeat.
- Deterministic state transitions under delayed/reordered signaling.

**Suggested files**
- `src/network/signaling.ts`
- `src/network/sync-protocol.ts`

---

#### 4) DataChannel flow control (QoS baseline)
**What to implement**
- Introduce prioritized send queues:
  1. control/sync (highest)
  2. telemetry/metrics
  3. bulk payloads (lowest)
- Use `bufferedAmountLowThreshold` and drain callbacks.
- Add bounded queue sizes and drop policy for low-priority traffic.

**Acceptance criteria**
- Control messages are delivered on time under stress.
- No UI freeze or uncontrolled buffer growth.

**Suggested files**
- `src/network/rtc-transport.ts`
- `src/network/peer-manager.ts`

---

### P1 — High (Sprint 2)

#### 5) Peer readiness gating for distributed operations
**What to implement**
- Add explicit readiness states (`synced`, `readyForCapture`, `readyForScan`).
- Include only ready peers in distributed capture requests.
- Surface non-ready reasons in UI diagnostics.

**Acceptance criteria**
- Capture/scan orchestration ignores unprepared peers by design.
- Operators can see why peers were excluded.

**Suggested files**
- `src/network/peer-manager.ts`
- `src/network/distributed-array.ts`
- `src/ui/peer-ui.ts`

---

#### 6) Better clock sync and drift compensation
**What to implement**
- Improve offset estimation with outlier rejection and median windows.
- Track drift over time and resync periodically.
- Feed sync confidence into capture window decisions.

**Acceptance criteria**
- Stable offset/drift metrics under variable RTT.
- Fewer misaligned remote captures.

**Suggested files**
- `src/network/sync-protocol.ts`
- `src/network/distributed-array.ts`

---

#### 7) Adaptive remote capture window
**What to implement**
- Move from static margins to adaptive pre/post windows.
- Scale by observed jitter + sync confidence.
- Cap min/max margins to avoid extremes.

**Acceptance criteria**
- Lower probability of clipped/empty captures in noisy networks.
- No excessive latency inflation.

**Suggested files**
- `src/network/remote-capture-handler.ts`
- `src/scan/ping-cycle.ts`

---

### P2 — Feature expansion (Sprint 3+)

#### 8) Distributed calibration mode (new)
**What to implement**
- Add calibration mode switch: `local-only` vs `distributed`.
- Calibration orchestrator requests remote calibration captures.
- Merge local + remote calibration inputs with quality weighting.

**Acceptance criteria**
- In distributed mode, peers are actually used in calibration math.
- Quality metrics improve vs local-only baseline in multi-device setup.

**Suggested files**
- `src/calibration/engine.ts`
- `src/network/distributed-array.ts`
- `src/ui/app.ts` / `src/ui/controls.ts`

---

#### 9) Calibration input quality gating
**What to implement**
- Define reject thresholds (SNR/consistency/latency confidence).
- Exclude poor peer inputs automatically.
- Persist rejection reasons for auditability.

**Acceptance criteria**
- Low-quality peers do not degrade final calibration.
- Clear diagnostics for each exclusion.

**Suggested files**
- `src/calibration/quality-score.ts`
- `src/calibration/band-fusion.ts`
- `src/ui/readouts.ts`

---

## Observability and Diagnostics (parallel track)

### 10) Runtime telemetry and peer diagnostics
**What to implement**
- Emit metrics/events for:
  - connect success/fail
  - ICE restart count
  - RTT/jitter/drift
  - capture success/fail
  - calibration participation/exclusion
- Add UI status reasons for degraded peers.

**Acceptance criteria**
- Operators can answer “why this peer did not participate” without logs deep-dive.

**Suggested files**
- `src/core/event-bus.ts`
- `src/network/peer-manager.ts`
- `src/ui/peer-ui.ts`

---

## Testing Strategy

### 11) Integration + chaos scenarios
**What to implement**
- Add integration tests for signaling retries, dedupe, and ICE restart.
- Add network-fault scenarios (delay/loss/reorder/jitter).
- Add acceptance tests for distributed calibration flow.

**Acceptance criteria**
- Deterministic pass criteria for key failure modes.
- Regression suite catches reconnect/signaling races.

**Suggested files**
- `tests/network/*`
- `tests/calibration/*`

---

## Rollout Strategy

### 12) Staged release with feature flags
**What to implement**
- Feature flags:
  - `webrtcResilienceV2`
  - `distributedCalibration`
- Canary rollout and metric-based progression gates.
- Fast rollback path by flags.

**Acceptance criteria**
- No forced all-user migration.
- Safe rollback in minutes.

---

## Recommended Execution Order
1. TURN support + ICE restart + signaling idempotency.
2. DataChannel QoS + readiness gating.
3. Sync/drift improvements + adaptive capture windows.
4. Distributed calibration and quality gating.
5. Observability hardening + full regression matrix + staged rollout.

## Risks and Mitigations
- **Risk:** TURN misconfiguration causes false negatives.  
  **Mitigation:** startup validation + explicit error surfacing.
- **Risk:** Retry logic creates loops/thrashing.  
  **Mitigation:** bounded backoff + attempt budget.
- **Risk:** Distributed calibration amplifies bad peer data.  
  **Mitigation:** strict quality gating + weighted fusion.

## Definition of Done (overall)
- WebRTC connection/recovery stable across target network scenarios.
- Distributed mode reliably executes remote capture and uses peers intentionally.
- Calibration behavior is explicit, test-covered, and observable.
- Feature flags allow safe incremental adoption and rollback.
