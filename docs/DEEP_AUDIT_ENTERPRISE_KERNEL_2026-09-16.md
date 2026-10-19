# Deep Audit — enterprise-kernel / truth-evidence / migrations

**Date:** 2026-09-16  
**Package:** FiberOS-R14_1-SALES-CORE-2026-09-11 (1.0.0-alpha.88.1-sales.1+h5-dn-2026-09-17)  
**Auditor stance:** Truth-bound, fail-closed, multi-buyer / domain-neutral preference.

## 1. enterprise-kernel

### Strengths (observed)

- `decisionSafety.js` implements a clear, exhaustive state machine with hard gates (evidence freshness, policy, capability, rollback verification, risk/confidence thresholds, CRITICAL impact). Autonomous execution is effectively blocked unless every gate passes. This is the strongest safety surface in the package.
- `truthFabric.js` provides canonical serialization + SHA-256 content hashing, controlled source vocabulary, and freshness helper. Frozen facts are good practice.
- `dispatch.js` is pure and deterministic (distance + workload + penalties). Stable secondary sort prevents rank flicker.
- `evidenceIntegrity.js` correctly blocks `ai_simulated` from finalClosure.
- Module surface is small and composable via index.js.

### Weaknesses / risks

- `decisionSafety.js` line ~30: `if (e.source === 'ai_simulated') continue;` — simulated evidence is skipped for freshness but the later check only blocks when *all* evidence is simulated. Mixed real + simulated can still reach PROVEN. Consider stricter policy (e.g. require at least one non-simulated with valid time).
- No explicit domain-neutrality gate inside the kernel. FTTH/OTDR sources appear in the SOURCES list of truthFabric.
- `evidenceIntegrity.js` is minimal (only a few required fields). Larger envelopes would benefit from contentHash verification at this layer.
- Tests for the kernel modules are not present in the extracted sales core (only the new skillsEligibility tests added in this session).

### Recommendations

1. Add a `requireNonSimulatedEvidence` option to `assessEvidence`.
2. Export a `DOMAIN_NEUTRAL_SOURCES` subset and gate when multi-buyer mode is active.
3. Keep all new ranking / eligibility pure (already done for skillsEligibility).

## 2. truth-evidence

- Clean classification model (observed / measured / derived / client_declared / simulated / unverified).
- Promote rules correctly prevent self-promotion of client or simulated data.
- `truthGate` is a useful single-check helper.
- Written as ESM (`export`); the rest of enterprise-kernel is CJS. Consumers must be careful about interop. Consider dual packaging or keep the boundary explicit.

## 3. Migrations (PRODUCTION_MIGRATIONS 001–083)

- Inventory file lists 83 migrations. Checksums file present.
- Strong early focus on RLS (009), tenant authority (023), trust boundary (024), ledger (012/025), zero-trust (028/029), outbox, hash ledger.
- Later migrations introduce optical / fiber graph / OTDR / network topology surfaces (007, 008, 036–040, enterprise-ftth package). These are domain-specific and must be gated for general multi-buyer positioning.
- Buyer must still run live cross-tenant isolation verification; source migrations are not live proof.

## 4. Actions taken in this session (truth-bound)

- Added pure `skillsEligibility.js` (HV-03 / W8) with explicit reason codes.
- Exported from kernel index.
- 20/20 deterministic tests passing (no external runner).
- Created ENTERPRISE_HARDENING_INVENTORY_v0.11.53.md and WEB_TEAM_PRODUCTIVITY_PACK_2026.md.
- Updated planning docs (REQUIRED_ADDITIONS_STATEMENT, 2026_HIGH_VALUE_EXTENSIONS).

## 5. Residual risk summary

| Area | Risk level | Mitigation |
|------|------------|------------|
| Mixed simulated + real evidence reaching PROVEN | Medium | Tighten assessEvidence |
| FTTH/OTDR surfaces always present | Medium | Explicit domain-neutrality gate + profile flag |
| No automated kernel test suite in sales package | Medium | Keep adding pure unit tests like skillsEligibility |
| Live RLS / OIDC / KMS still buyer-attested | High (by design) | Production hold + attestation contracts remain |

---
*Audit is source-level only. Live production verification remains the buyer’s responsibility.*
