# Enterprise Hardening Inventory — FiberOS R14.1 Sales Core

**Style:** capability → real module → honest scope  
**Baseline:** 1.0.0-alpha.88.1-sales.1+h5-dn-2026-09-17 (2026-09-17)  
**Updated:** 2026-09-17 (H-5 closure + domain-neutrality gate execution)  
**Positioning:** Source kit. Multi-buyer / domain-neutral mode preferred. FTTH-specific surfaces remain gated under sector profile.

## Inventory

| Capability (marketing language to avoid) | Real module / location | Honest scope (what it actually does) | Status |
|------------------------------------------|------------------------|--------------------------------------|--------|
| Decision safety / "self-healing" claims | `packages/enterprise-kernel/src/decisionSafety.js` | Deterministic state machine (PROVEN / UNCERTAIN / CONFLICTED / STALE / UNAUTHORIZED / REQUIRES_HUMAN_APPROVAL / EXECUTABLE / BLOCKED). Requires evidence freshness, policy, capability, rollback verification, risk/confidence thresholds. Never auto-executes. | Present & strong |
| Truth fabric / fact integrity | `packages/enterprise-kernel/src/truthFabric.js` | Canonical JSON + SHA-256 contentHash, controlled source list, freshness calculation, freeze. Sources include field_reading, nms_poll, otdr_file, photo_ocr, manual_entry, gis, inventory, customer_service, system, ai_simulated. | Present |
| Evidence integrity envelope | `packages/enterprise-kernel/src/evidenceIntegrity.js` | Validates ticketId, kind, source; blocks ai_simulated from finalClosure. SHA-256 of bytes. | Present (minimal) |
| Evidence classification gate | `packages/truth-evidence/src/index.js` | Classes: observed / measured / derived / client_declared / simulated / unverified. Promote rules prevent self-promotion of client/simulated data. truthGate helper. | Present |
| Candidate ranking (dispatch) | `packages/enterprise-kernel/src/dispatch.js` | Pure score = distance + workload + skill/availability/material penalties. Stable sort. No auto-assignment. | Present (deterministic) |
| Conflict engine | `packages/enterprise-kernel/src/conflictEngine.js` | (Exists; used by decision safety for OPEN conflicts) | Present |
| Capability / policy registry | `capabilityRegistry.js` + `policyEngine.js` | Capability and policy checks feeding decisionSafety. | Present |
| Decision certificate | `decisionCertificate.js` | Produces signed/structured decision records. | Present |
| Incident kernel | `incidentKernel.js` | Incident handling surface. | Present |
| Command surface | `command.js` | Command entry points. | Present |
| Mathematical truth registry | `config/mathematical-truth-registry.json` | Explicit metrics (Distance, Inventory, SLA, ETA, Optical degradation) with validity + fallback (NO_RESULT / NO_KPI / NO_ETA). Rule: unverified metric never rendered as fact. | Present |
| Production integration boundaries | `config/production-integration-boundaries.json` | Fail-closed flags for OIDC, PostgreSQL, routing, telemetry.nms_otdr, object_storage, KMS, messaging.outbox. All start disabled / unverified. | Present |
| Tenant containment / RLS | sql/migrations (009_rls_core, 023_p0_tenant_authority, 072_r14_1_tenant_containment_hardening, others) | RLS policies + authority helpers. Must be verified live by buyer. | Source present |
| Production hold | packages/core (referenced in SELLER_README) | Active by default; requires FIBEROS_PRODUCTION_VERIFIED + buyer attestation. | Present |
| Outbox pattern | migrations 010, 016, 031 + related | Retry schedule, claim, attempts. Buyer-keyed notifications. | Present |
| Hash / ledger | 012_hash_ledger, 025_p0_ledger_append_authority | Append-only style integrity. | Present |
| Zero-trust hardening | 028, 029 | Integrity gates. | Present |
| Domain-neutrality gate | `packages/assurance/src/domain-neutrality-gate.js` | Forbidden terms (FTTH, GPON, OLT, ONT, OTDR, PON, splitter + variants) blocked or flagged when multi-buyer / domain-neutral mode is selected. FTTH source remains available under explicit sector profile. Static check + exportable list. | Present (strengthened 2026-09-17) |
| JWT claims vs tenant isolation (H-5) | `packages/security/src/buildJwtClaims.js` + RLS via `fiberos_current_tenant_id()` / `user_preferences` | Claims (`org_id`, `nation_iso`, `employee_id`, `role_key`) are advisory only. Enforced isolation boundary is solely `tenant_id`. No `organizations` table; no invented mapping. Explicit comments + decision recorded in REQUIRED_ADDITIONS_STATEMENT. | Closed by truth-bound decision 2026-09-17 |

## Domain Neutrality Notes

- Package contains optical / FTTH-related modules (`ftthRates.js`, `packages/ftth-measurements`, migrations with OLT/ONT/SPLITTER, `/v1/ftth-advisory` routes, OTDR-related sources). These are real and retained for sector buyers.
- Multi-buyer / domain-neutral mode uses the strengthened gate (`packages/assurance/src/domain-neutrality-gate.js`). Forbidden terms are blocked or flagged in sales/UI/capability surfaces.
- Marketing language must not present FTTH-specific surfaces as core multi-buyer capabilities. They are optional sector profile.
- H-5 decision (2026-09-17): JWT org claims are never treated as the tenant isolation boundary.

## Explicit Non-Claims

- No autonomous execution path exists that bypasses REQUIRES_HUMAN_APPROVAL / BLOCKED states.
- No on-device or local LLM.
- No road-network ETA (ETA is INTEGRATION_DEPENDENT + NO_ETA fallback).
- No live production certification is delivered; buyer must attest.
- No hard-coded third-party credentials.
- No automatic mapping between JWT `org_id` and RLS `tenant_id` (H-5 closed by explicit separation).

## Recommended Next Hardening Actions

1. ~~Add or strengthen an explicit `domain-neutrality-gate.js`~~ — Done 2026-09-17.
2. Document sign-off / signature-chain once (avoid duplication).
3. Ensure every new HV feature updates this inventory with the same three-column honesty.
4. Keep SALES_PACKAGE_MANIFEST and checksums in lock-step after any change.
5. Buyer decision: whether to wire their own organization model to the advisory JWT claims later.

---
*Inventory is truth-bound. Marketing language is mapped only to real code that exists.*
