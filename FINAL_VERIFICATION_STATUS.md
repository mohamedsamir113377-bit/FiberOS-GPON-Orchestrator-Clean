> **Current source/CI snapshot (2026-10-18):** `main` head `aef4f50dab3440bf47f00c72a802859874f964aa` passed exact-head release-admission and source verification (892 tests: 892 passed, 0 failed, 0 skipped); migration sequence/document alignment, 1,381-file manifest parity, PostgreSQL/PostGIS RLS runtime, source hygiene, runtime-container gates, website build, visual regression, i18n gate and truth-check passed on that exact head (run 39076331902, 2026-10-17T22:45Z). PR #74 was merged at 2026-10-17T22:16:43Z; the migration-191 reconciliation is contained in `main` and all five gates are green on `aef4f50`. Read-only Neon inspection (2026-10-18, project `fragrant-voice-83289037`): production branch `br-tiny-cherry-b4x1vpkw` is intact; roles `fiberos_owner`, `fiberos_migrator`, `fiberos_runtime`, `fiberos_app`, `fiberos_worker`, `fiberos_policy_reader`, `fiberos_buyer_review`, `anon`, `authenticated` are `no_login` and only `neondb_owner` holds a password; the project IP allowlist is EMPTY, so network-level restriction is NOT yet enforced — with Vercel serverless egress being dynamic, restriction must come from credential rotation plus scoped `no_login` roles (already in place), or from a fixed egress gateway before an allowlist is applied. The Vercel project `gpon-orchestrator` exists but reports ZERO linked Git projects, so a live production deployment matching `main` is still UNPROVEN. **Status remains: SOURCE GREEN / RUNTIME ADMISSION PENDING — NOT PRODUCTION READY** until a live Vercel deployment tied to `aef4f50` is proven and buyer runtime acceptance (including `docs/runbooks/BUYER_DEMO_DATA_SEED.md`) completes.

> **Historical review-branch record (2026-10-16; retained for traceability and not the current release status):** `audit/pre-ci-static-clean-2026-10-16` was created from current `main` SHA `52c770ad9d6bd5d9519082fe5aab8fc9fa25bd20`; the prior divergent review branch is left untouched. This branch contains static source/documentation changes only, is not admitted for release, and its generated `SALES_PACKAGE_MANIFEST.json`, hashes and provenance have not been regenerated for this exact tree. **Release HOLD:** the existing push-triggered Actions suite on main SHA `52c770ad9d6bd5d9519082fe5aab8fc9fa25bd20` (2026-10-15 21:52 UTC) failed for release admission, PostgreSQL/PostGIS RLS, source verification, source hygiene, all four runtime-container image jobs, website build, truth-check, and visual regression. A separate Vercel deployment status was success, but it does not override these failures. The connected API could not retrieve job step details/log content (`BlobNotFound`/empty step lists), so failure causes remain unconfirmed; no cause is guessed here. No final-gate run was started on this clean review branch, no release tag was created, and no Vercel or Neon Production change was made. Dependency/SBOM and Migration 188 ECL defects remain blockers; locale linguistic certification remains open.

> **Historical static-audit finding (2026-10-16; source baseline `3671a25820094f71e69d963b87bf5a857b038ce4`): HOLD at that baseline — NOT PRODUCTION READY.** The pre-CI static audit is recorded at `docs/audit/PRE_CI_STATIC_AUDIT_2026-10-16.md`. It found a dependency/SBOM mismatch (`net-snmp@3.29.1` in the lockfile while upstream `3.29.2` includes a malformed-UDP denial-of-service fix; the lock entry also lacks an integrity field, and the SBOM dated 2026-09-30 omits that component) and material migration-188 audit-chain gaps. Do not run the final CI gate or promote the release until these findings are resolved and the release manifest/provenance is regenerated. This addendum is documentation only; no CI, Vercel deployment, or Neon production migration was run.
>
> **Current capability registry at that source baseline:** 106 entries — REAL 55; INTEGRATION_REQUIRED 4; ADVISORY 23; VISION 24; UNIMPLEMENTED 0. REAL means source plus repository evidence/tests, not buyer-production certification. The locale pack passed static key parity at this SHA: **114/114 catalog JSON files** each carry the 101 exact canonical keys with zero missing/extra (the official sales subset remains the 84 catalogs enumerated in `i18n/official-84.json`); 112 catalogs remain machine-draft and human semantic certification is not claimed. Corrected 2026-10-16: the earlier 84/84 wording described the sales subset, not the delivered tree.
>
> **Governance:** `docs/BRANCH_PROTECTION_POLICY.md` records the required policy. Native GitHub protection remains unverified until the API confirms it. The consolidation reference SHA is a baseline, not proof of current hosted CI or live deployment status.

> **Historical snapshot (2026-10-13, superseded):** an earlier closeout referenced main `18c3252fc62ca00e4ade825a1b273c1404492dcb` and the Neon ledger through migration 186. The final main/Neon closeout is recorded in `docs/evidence/NEON_PRODUCTION_MIGRATION_ATTESTATION_2026-10-13.md`.

> **Status banner (2026-10-14):** FINAL HANDOFF CANDIDATE — **NOT PRODUCTION READY**. Source, build, security, and isolated PostgreSQL/PostGIS checks are engineering evidence only and do not certify the buyer’s live deployment. Live identity, messaging, Redis HA, object storage, KMS/HSM, backup/recovery, and buyer-operation acceptance remain independently unverified. Source migration chain: 001-196 (Neon production ledger historically verified through 187 on 2026-10-13).

# FiberOS R14.1 — Current Verification Status

The previously reported local run (**851 tests: 850 passed, 0 failed, 1 skipped**) belongs to an earlier fix branch and is historical evidence only. It does not certify the current `main` head. Exact-main hosted CI and Vercel production have since passed on the PR #44 merge SHA; see the final closeout evidence addendum. Buyer-owned runtime acceptance remains separate.

**Historical verification only (2026-10-14; not a run on reference SHA `3671a25820094f71e69d963b87bf5a857b038ce4`):** `npm run verify` on the earlier consolidated tree executed **884 tests: 884 passed, 0 failed, 0 skipped** (measured locally on Node 24.21.0 with a live Redis instance via `FIBEROS_REDIS_TEST_URL`; the suite includes the fail-closed engines-contract gate and the production-readiness gate). A prior hosted run applied the migration chain then present through migration 184 to its PostgreSQL 18.6 / PostGIS 3.6.4 test instance: `live-postgres-rls.js`, `ftth-audit-rls-semantic-audit.js`, `adversarial-db-runtime-audit.js` and `adversarial-tenant-fk-mutation-audit.js` all exited 0 with `runtimeGate: VERIFIED_RUNTIME`.


**Historical verification reference:** `a2199fcc6879f46f6297ae7533982b0d4f71af06` was a prior baseline; its checks are not evidence for later commits or this integration candidate.
**Buyer runtime-attestation boundary:** source implementation and tests do not certify a live buyer deployment; signed buyer evidence and acceptance remain mandatory.

**Version:** `1.0.0-rc.1+commercial.2026-09-25`
**Historical main baseline for the earlier consolidation:** `3e6e415dcaf132df18f2b32d3606e5a514976e2f`; later exact-main verification is recorded in the final closeout evidence addendum.
**Runtime baseline:** Node.js `24.21.0` / npm `11.19.0`
**Production source chain:** `001-196` (contiguous). Following PR #44, the Neon production migration ledger was re-read at 187 rows through `187_pin_security_definer_search_path.sql`; its SHA-256 matches the source manifest, with zero malformed hashes. The six protected trigger functions remain pinned and their triggers enabled.
**Release decision:** **BUYER LIVE RUNTIME PROOF AND SIGNED GO-LIVE ACCEPTANCE PENDING — green source CI does not certify the buyer deployment**

Historical sections below retain dated source-gap and CI snapshots. They are not current run results; this 2026-10-10 status supersedes earlier statements that all hosted jobs stopped with zero steps.

## Generated release provenance

<!-- BEGIN GENERATED:release-provenance -->
- Generated manifest scope: **1,393 files / 57,567,318 bytes** (the manifest self-entry is excluded from the byte total); migration chain **001–196**; version **1.0.0-rc.1+commercial.2026-09-25**.
- This block is machine-rendered from the source tree by `scripts/release-provenance.js`; `--check` fails closed on drift, so these counters cannot diverge from the shipped tree.
<!-- END GENERATED:release-provenance -->

## Final audit scope

This review fixed the buyer capability runtime scope error, made buyer-data publish the complete canonical capability registry, added migration 176 to run tenant resolution as the restricted `fiberos_policy_reader`, restored working command palettes on Ops/Field, and synchronized delivery docs, archive exclusions, and visual baselines. Manifest/provenance are regenerated and locally verified against this exact tree.

The final cleanup also removed three obsolete alternate-admission/diagnostic files:
- `scripts/local-release-admission.js`
- `docs/runbooks/ADVERSARIAL_RELEASE_PATH.md`
- `docs/runbooks/GITHUB_ACTIONS_RUNNER_ADMISSION.md`

No product/runtime source was removed by that cleanup. The active CI/runtime gates remain in `.github/workflows/`.

## CI routing boundary

**Historical incident note (2026-10-08 / earlier candidate):** a hosted PostgreSQL/RLS run failed with SQLSTATE `42501` because `fiberos_current_tenant_id()` was owned by `fiberos_owner` (`NOBYPASSRLS`) while `user_preferences` enforced RLS. Migration 176 moved the fixed, column-scoped resolver to the non-login `fiberos_policy_reader`. This records the pre-fix incident; it is not the current CI result. On final `main` SHA `a6c55b5638e3f11f5b8043ec727b27797f7eae57`, the hosted PostgreSQL/PostGIS RLS runtime gate and release-admission gate passed, and source verification reported 884 tests passed / 0 failed. The migration-sequence workflow passed on code-bearing merge SHA `5d06e1c9c1c32a5c7a4117770c65344525d0e122`; the subsequent PR #45 changed documentation/provenance only. Vercel production is `READY` on the final main SHA. The `sync-sales-manifest` workflow remains read-only and fail-closed.

## What is closed at source level

- Candidate migration chain: `001-196` is contiguous. Exact `main` head `aef4f50dab3440bf47f00c72a802859874f964aa` passed release admission, source verification (892/892 tests), migration sequencing/document alignment, manifest parity, PostgreSQL/PostGIS RLS runtime, source hygiene, container checks, website build, visual regression, i18n gate and truth-check (run 39076331902). PR #74 was merged at 2026-10-17T22:16:43Z and the migration-191 reconciliation is contained in `main`. Neon Production was read-only verified through migration 191. These engineering checks do not certify buyer-owned runtime integrations.
- Required sequence: `121-128`
- Migration SHA-256 ledgers: migrations 001-196 are registered; exact-main manifest/provenance and migration-sequence gates passed.
- Commercial release verifier: migration 128 enforced
- Public tracking source scope: narrowly selected fields; no technician-wide `SELECT *`
- `fiberos_app`: NOLOGIN / non-superuser boundary retained
- Public tracking: transaction-local role/token boundary retained
- Tenant containment: migration 128 ties token hash, token validity/revocation/expiry, and job/location tenant match
- Manifest self-entry: `SELF_REFERENTIAL_NOT_HASHED`
- Main branch: PR #44 was merged; exact-main CI and Vercel production deployment passed for the merge SHA.
- Production Hold: fail-closed
- Production identity: RS256/JWKS path retained
- Buyer-facing evidence: machine-forensic language remains explicitly distinct from human linguistic certification

## Evidence boundary

Exact-main source and hosted CI checks passed for the PR #44 merge SHA, and Neon production was verified through migration 187. The final closeout evidence is in `docs/evidence/NEON_PRODUCTION_MIGRATION_ATTESTATION_2026-10-13.md`. These engineering checks do not certify every buyer-operated runtime.

The remaining commercial release blockers are:
1. Buyer-owned signed runtime attestation and authorized signed go-live decision for the exact delivered archive.
2. End-to-end tenant A/B authorization and scope tests with populated tenant, technician, ticket, and assignment data; the checked core production tables contained zero rows.
3. Restrictive Neon network posture: the allowed-IP list is empty and public connections are not blocked. Establish and test application egress and recovery access before changing these settings.
4. Explicit least-privilege review of `fiberos_policy_reader` (`rolbypassrls=true`, `rolcanlogin=false`) and its scoped functions, grants, ownership, and memberships.
5. External runtime proof for Redis HA, live OIDC/JWKS identity, object storage, KMS/HSM, messaging, telemetry, backup/restore, and vendor adapters.
6. Capability/locale contract: at source baseline 3671a25 the registry records 55 REAL, 4 INTEGRATION_REQUIRED, 23 ADVISORY, 24 VISION, and 0 UNIMPLEMENTED. The official 84-locale contract passed static key parity: all 84 JSON files have the 101 canonical keys, with zero missing/extra and metadata aligned to the 114-locale manifest. Translation remains automated; human linguistic certification remains open.
7. Publication of the admitted source archive and its matching external SHA-256 sidecar.

## Release rule

The source merge gate was satisfied for PR #44: its exact merge SHA passed source verification, PostgreSQL/PostGIS/RLS, migration sequencing, runtime image/source security, release admission, website build/performance, and visual regression; Vercel production was `READY` on that SHA, and Neon production was recorded through migration 187. The release itself must remain on hold until buyer-owned runtime acceptance, populated-tenant authorization testing, required external-service evidence, and publication of the verified archive/sidecar are complete.

## Deep Reality Kernel implementation update — 2026-10-07

Migration `136_network_reality_kernel.sql` and the `network-reality-kernel` package add source-backed boundaries for canonical asset semantics, effective operational observations, evidence-bound truth claims, non-live counterfactual scenarios, bounded authorized commands, persistent integrity findings, tenant RLS/FORCE-RLS, and database-level active ODN port exclusivity. These are source implementations with unit-test evidence; they are not promoted to runtime-certified capabilities until exact-head hosted execution succeeds.

## Master Operating Statement implementation cycle — 2026-10-07

The 82-page FTTH CORE — Master Operating Statement 2026-10-07 was reviewed as the target specification. The branch now contains source-level foundations aligned to its prescribed Phase 1–13 order.

Added in migrations 137 and 138:
- canonical asset classification registry and semantic links;
- transaction-bound fibre/core continuity and splice-range guards;
- structured, effective-dated service-path hops (the JSON path on the version record is explicitly a projection, not the canonical path source);
- a shared operational graph edge model;
- asset-specific acceptance gates for ODN/cable/duct promotion to ACCEPTED/LIVE;
- standards-aware OLT/NMS telemetry source and correlation boundaries without claiming a live vendor connection;
- authority-policy, evidence-admissibility, truth-compilation, conflict, uncertainty, causal-hypothesis, replay and commercial-claim records;
- first-class building/floor/riser/unit/riser-box hierarchy;
- civil inspection and corridor-risk records;
- continuous integrity scan source logic;
- failure-domain and non-live capacity scenario storage;
- proof-carrying command fields and verification guardrails;
- tenant-safe reference guards and tenant-local monotonic replay sequencing.

The JavaScript reality kernel was also expanded with semantic resolution, authority/conflict handling, evidence admissibility, canonical truth compilation, invariant evaluation, conservation checks, state-transition validation, proof-carrying command construction, counterfactual simulation, causal classification, uncertainty representation, deterministic replay, safety-budget evaluation and claim validation. Unit tests were extended for these boundaries.

A formal coverage matrix now records the source/test/runtime state for the master statement and Acceptance Tests 01–16: docs/MASTER_OPERATING_STATEMENT_COVERAGE_2026-10-07.md.

**Historical feature-boundary note (2026-10-07):** the source additions in this architecture section were not individually runtime-certified on that date. Later exact-main hosted CI and PostgreSQL/PostGIS/RLS gates passed, but those checks do not certify provider-controlled NMS/OLT, KMS/HSM, real instruments, buyer infrastructure, or buyer acceptance.

Migration `139_service_path_and_optical_assurance_guards.sql` adds database authority for immutable live service-path versions and an append-only optical-assurance assessment ledger. It does not forecast or manufacture field measurements.

Migration `140_proof_state_control_kernels.sql` adds the explicit Proof Graph, State/Invariant journal, Safety Budget records and non-autonomous Closed-Loop Control stages required by the master statement. These are auditable structures and pure control boundaries; they do not grant autonomous production mutation.

The main verification chain now includes `verify:master-statement`, a static no-illusion gate that checks the master-statement coverage matrix and required migration/kernel artifacts without converting source presence into runtime readiness.

## 2026-10-07 source-gap closure

- Added `@fiberos/offline-field-queue`: browser-oriented AES-256-GCM encrypted queue records, IndexedDB persistence adapter, deterministic reconnect/conflict state transitions, bounded retry, and explicit client tenant-authority rejection.
- Added deterministic interrupted-control recovery guard to `@fiberos/network-reality-kernel`; recovery requires re-authorization and cannot skip verification or silently commit.
- These are **SOURCE IMPLEMENTED / UNIT-TESTED BY DESIGN**, but exact-head execution remains unproven because hosted CI/runtime admission has not been executed. No runtime PASS is inferred.


## Source-level closure cycle after 2026-10-07 handoff

The current handoff head adds the following source-level closures without changing the production evidence boundary:

- @fiberos/operations-trace: bounded explicit-link end-to-end trace resolution with BROKEN/AMBIGUOUS outcomes and content hashing.
- @fiberos/gis-reconciliation: deterministic planned/field/as-built reconciliation with tenant-aware identity, geometry tolerance and explicit review states.
- @fiberos/contact-center-intelligence: explicit call/ticket/service/incident/asset correlation graph; ambiguity is preserved rather than silently selecting an incident.
- @fiberos/offline-field-queue: generic operation envelope with server-authority tenant metadata, idempotency and bounded expiry.
- @fiberos/network-reality-kernel: optical evidence provenance guard and explicit recovery reauthorization reference.
- Static governance gates: API authorization matrix, security surface scan, performance/resource contract and commercial consistency.

These additions remain source/test evidence only. PostgreSQL 18/PostGIS 3.6/RLS execution, hosted CI, real vendor adapters, KMS/HSM, physical instruments, buyer infrastructure and device-level field execution remain separate proof boundaries.


## Department KPI closure — migration 144

Migration `144_department_kpi_truth_primitives.sql` closes the six previously schema-deferred department KPIs with actual persisted source paths:

- First-Time-Fix: database-observed reopen tracking on `tickets`.
- Technician travel: existing `technician_positions.speed_mps` bounded moving intervals.
- Revenue per ticket: existing non-void `invoices.amount_minor`, kept separate by currency.
- Cable reel remainder: new append-only exact millimetre conservation ledger.
- Splitter-leg utilisation: direct `network_ports.port_type/status` derivation.
- PON optical margin: path-bound optical assurance linked to field/NMS measurements.

The endpoint `GET /v1/operations/department-kpis/{department}` is tenant-scoped and database-backed. Unit tests cover the calculations and endpoint fail-closed behavior. Runtime PostgreSQL/RLS execution remains unproven.

Migration 142 was also repaired on this branch: its PON boundary SQL had an unterminated hash CHECK and duplicated statements after the final COMMIT. The branch now contains one canonical executable body.

### Commercial control-plane foundations (migration 147)

Source-implemented without runtime admission claims:

1. **Entitlement + Usage Engine** — `portal_usage_metric_catalog`, `portal_plan_entitlements`, append-only `portal_usage_ledger` (FORCE RLS, immutable). APIs: `GET /v1/customer-portal/entitlements`, `POST /v1/customer-portal/usage/authorize`.
2. **Service Order FSM** — `portal_service_orders` + immutable events; types from SERVICE_REQUEST through CONTRACTOR_WORK; explicit transitions only.
3. **SLA Clock Engine** — `portal_sla_contracts` + `portal_sla_clock_events`; evaluation from documented timestamps only (`evaluateSlaClocks`).

Status remains: **SOURCE IMPLEMENTED / RUNTIME ADMISSION PENDING — NOT PRODUCTION READY**.

### Contractor + commercial reconciliation (migration 148)

SOURCE IMPLEMENTED / UNIT TESTED (not runtime-admitted):

1. **Order ↔ Work Package bridge** — `portal_order_work_package_links`
2. **Contractor WP lifecycle events** — immutable `contractor_work_package_events` aligned to `ftth_work_packages.status`
3. **Commercial measurement reconciliation** — Maker/Checker SoD; `payment_reconciled` requires provider evidence
4. **SLA enforcement thresholds** — 80% breach_risk / 100% breached from clock elapsed only

APIs under `/v1/contractor-commercial/*`. **NOT PRODUCTION READY** until hosted runtime admission.

### Multilingual contact center — speech adapter boundary

SOURCE IMPLEMENTED / UNIT TESTED:

- Fixed silent dialect fallback: unregistered locales (e.g. ar-MA) force HUMAN_HANDOFF_REQUIRED; never substitute ar-EG.
- Low-confidence language ID forces handoff.
- Multi-provider speech adapter boundary (LOCAL_SOVEREIGN, OPENAI_REALTIME, AZURE_SPEECH, NVIDIA_RIVA, ASTERISK_MEDIA_BRIDGE) — probe/select only; `runtimeConnected: false` always at source layer.
- APIs: POST `/v1/contact-center/speech/probe`, POST `/v1/contact-center/speech/select`.
- Conversation create persists `HANDOFF_REQUIRED` when locale/voice not certified.

Runtime media (SIP/WebRTC/ASR/TTS golden tests per locale) remain **UNVERIFIED**.

## Delivery-gate closure progress (2026-10-08)

| Gate | Status |
|------|--------|
| Source feature freeze (no new product features in this pass) | Observed |
| Migration sequence 001–180 + SHA ledgers | **PASS** — contiguous; checksums exact |
| Sales manifest (`scripts/regen-manifest.js`) | **PASS** — generated from the exact source tree; counters are in the manifest |
| RLS inventory | **PASS** — 186 total tables; 168 tenant-sensitive; migration counters 158 |
| `npm ci --ignore-scripts --no-audit --no-fund` | **PASS** — 163 packages installed from repaired lockfile |
| Static delivery gate (`scripts/verify-delivery-gate-static.js`) | **PASS** — release metadata consistent; runtime not claimed |
| Release integrity (`scripts/verify-release-integrity.js`) | **PASS** — workspace graph, migration inventory and version contracts |
| Adversarial DB static audit | **PASS / STATIC ONLY** — 158 migrations, checksum verified; `productionCertification=false` |
| Hosted CI runner probe | **FAIL** — 0 steps, empty `runner_name` (Actions enabled; dual-label probe added for diagnosis) |
| PostgreSQL/PostGIS RLS runtime | **NOT EXECUTED** (hosted job was created but had zero steps; no local Docker) |
| E2E Reality Chain in live DB | **NOT EXECUTED** — schema/modules present statically |
| Security adversarial runtime | **NOT EXECUTED** |
| Commercial Release Candidate claim | **FORBIDDEN** until Source→Manifest→CI→DB/RLS→Security→E2E→Admission all pass |

**Correct pipeline:** Source → Manifest → CI → DB/RLS Runtime → Security → E2E → Release Admission

### Next gate progress (adversarial static + local DB harness)

- Repaired `scripts/buyer-acceptance/adversarial-db-static-audit.js` (was non-executable: missing `readText` / `extractSecurityDefiners`).
- Fresh adversarial DB static audit: **PASS** through migrations **001–180** with checksums verified; `productionCertification: false`. This is static evidence only, not effective privilege or concurrency proof.
- Added `scripts/buyer-acceptance/run-local-postgres-rls-gate.sh` — fails closed without `ADMIN_URL`/`MIGRATOR_URL`; mirrors CI migration apply path when PostGIS is available.
- Exact-head GitHub Actions: runner probe and release-admission jobs failed with **0 steps / empty runner** on both labels; hosted CI, live RLS, and runtime admission remain blocked.

### Reality Chain static E2E (2026-10-08)

- `packages/operational-context/test/realityChain.e2e-static.test.js` — **6/6 PASS**
- `scripts/verify-reality-chain-static.js` — **PASS**
- Chain covered statically: Customer → Conversation → Language Negotiation → Handoff → Canonical Operational Event → Incident → Evidence → Trace
- Adversarial static cases: correlation mismatch, forged causation, dangling incident/evidence links
- Runtime flags remain false: eventPublish, evidenceStorage, telephony, speechExecution
- **Not a substitute** for PostgreSQL/RLS live admission

### Organization scope, Contact Center trust, and source-map reconciliation (2026-10-08)

- API message ingestion now fixes `evidenceClass` to `declared`; client-provided `sourceLocale`, `targetLocale`, `audioReference`, and `providerReference` remain explicitly unverified claims.
- Migration `157_contact_center_evidence_trust_guard.sql` rejects direct message inserts that self-assert any evidence class other than `declared`; validated promotion remains the responsibility of the evidence subsystem.
- Department KPI travel-role mapping is limited to the two departments backed by technician role assignments; no role authority is invented for other departments.
- Department KPI reads now require an active enterprise position in the requested department or its descendants; `exec`/`sysadmin` retain tenant-wide read scope. Migration 158 grants the API role read-only access to these hierarchy tables under tenant RLS.
- The architecture map is regenerated from the current package tree. This is source/static evidence only; PostgreSQL trigger execution, hosted CI admission, and production telephony/speech remain unverified.

### Local test evidence on this source tree (2026-10-08)

- Focused changed-surface suite: **36 tests: 36 passed, 0 failed, 0 skipped**.
- Historical pre-fix repository suite recorded **623 tests: 599 passed, 23 failed, 1 skipped**. The skipped test is the Redis shared-limiter integration, which requires a configured Redis test service.
- Full-suite failures remain in field-web asset contracts, shared-risk/GIS/reality-acquisition tests, offline queue tests, legacy field-close/canonical-event boundaries, management-surface fixtures, and HTML token/depth-layer contracts. The complete suite therefore remains **FAIL**; this candidate is not admitted for release.
