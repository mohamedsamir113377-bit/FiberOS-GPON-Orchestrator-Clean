# FiberOS R14.1 — Commercial Release Status

## Release identity

- Version: `1.0.0-rc.1+commercial.2026-09-25`
- Status: **COMMERCIAL RELEASE CANDIDATE**
- Source migration chain: **001-196**. Read-only Neon Production inspection on 2026-10-17 found **196 ledger rows**, latest `196_narrow_app_technician_read_scope.sql`; its stored SHA-256 `8d1dc04c47842953b4189e75fec44170317b6b8c753b3852a8100efa0b41b40b` matches the source checksum ledger. The live `event_outbox_contract` trigger now calls `ecl_capture('event_id')`; **10 active** public `t_ecl_*` triggers remain. An earlier isolated `m190-apply-test-20261017` smoke test exercised a separate test branch before migration 196 and is historical evidence only; it does not prove post-196 production business writes. These production checks were read-only; no production write was made. Buyer-owned runtime integrations and go-live evidence remain pending.
- Reference list price: **USD 3,500**
- Current online campaign price: **USD 3,000** (USD 500 discount)
- Standard support proposal: **14 calendar days**
- Reference verification date: **2026-09-25**
- Historical consolidation baseline: `fc10354211e0656c304363edba52e9b3a3db8dad`. Code-bearing PR #44 merged as `5d06e1c9c1c32a5c7a4117770c65344525d0e122`; PR #45 aligned `main` at that time to `a6c55b5638e3f11f5b8043ec727b27797f7eae57`. The previously recorded SHA `811b25695c4eb427462d15481537baa62f679874` is not the SEO implementation baseline. SEO implementation commit `a062e19d3c33135a30c30e7ade0d1239b89e8ec5` (PR #71) passed exact-SHA release-admission, truth-check, website-build and visual-regression. This historical reference does not assert that a subsequent documentation-only commit or future `main` HEAD has the same SHA. The last inspectable Vercel production deployment is `dpl_8jJQZKueVz6e7FBcdtfssNmjjmHf`, `READY` on older SHA `6d0f61e3109fe0674a273f23fe302c876d26692e`; deployment listing/creation through the connected Vercel account is denied (403), so current production parity and public SEO endpoint responses remain unverified. Buyer acceptance remains separate.
- Current integration gate: **RELEASE HOLD for buyer delivery**. PR #74 contains migration-191 manifest/inventory/provenance reconciliation and passed the last checked exact-candidate release-admission run, but is still Draft and unmerged. `main` remains at `2527d64754766ab530650648cb1e25da03a52662`; its latest release/source/RLS checks are red because the committed manifest and RLS counters still say 190 while the source chain is 191. The connected Vercel team context currently has no linked projects and current production/source parity is unverified. Buyer-owned runtime acceptance and publication of a formal release archive plus external SHA-256 sidecar remain pending.
- Buyer production runtime evidence: **NOT YET OBSERVED — must be generated in the buyer-owned deployment; seller CI is not a substitute**.
- Go-Live acceptance: **PENDING — requires a fresh signed buyer runtime attestation and a separately signed authorized buyer decision**.
- Product-completeness caveat: the 106-capability registry contains 0 `UNIMPLEMENTED`, 24 `VISION`, 23 `ADVISORY`, and 4 `INTEGRATION_REQUIRED` entries. The current 114-catalog manifest reports 2 verified, 112 machine-draft, 0 untranslated, and 0 human-certified catalogs; full linguistic acceptance is not met.
- Commercial package status: **FROZEN SOURCE CANDIDATE — buyer runtime evidence and signed Go-Live acceptance remain release gates**.

## Current verification matrix

<!-- BEGIN GENERATED:manifest-scope -->
- Frozen manifest scope: **1,393 manifest-tracked entries / 57,567,318 bytes**, excluding the manifest self-entry plus the declared delivery-scope exclusions (`.git`, `MANIFEST_BUILD_STAMP.txt`, `apps/field-web/public/engineering-demo.html`, `apps/field-web/public/buyer-demo.html`, `.github/workflows/neon-pr-preview.yml`).
- Counters are machine-generated from the tracked source tree by `scripts/release-provenance.js`; hand-typed counters are not permitted in this document.
- Production migration chain: **001–196**; product version: **1.0.0-rc.1+commercial.2026-09-25**.
<!-- END GENERATED:manifest-scope -->

| Area | Seller/reference evidence | Buyer production status |
|---|---|---|
| Node.js 24.21.0 | Verified in supplied external lab record | Buyer must reproduce |
| PostgreSQL 18.6 / PostGIS 3.6.4 | Reference DB execution recorded; RLS/tenant controls and post-fix incident path are documented in the later result set | Buyer acceptance required |
| OIDC/JWKS RS256 | 7-case local/reference matrix recorded | Buyer IdP/issuer/JWKS must be verified |
| TLS | TLS 1.3 runtime checks recorded, including untrusted CA/hostname rejection | Buyer ingress/certificates must be verified |
| Dependencies | Historical 2026-09-25 scan recorded npm audit 0 vulnerabilities and OSV-Scanner 2.6.0 `No issues found`; current CI reruns both against the current lockfile | Buyer policy scan should still be rerun |
| Production hold | Fail-closed source control and live attestation requirements are present | Buyer-owned attestation required |

## Evidence qualification

The supplied evidence archive contains both historical pre-fix records and later post-fix result records. In particular, `REPORT.md` and `rls_err2.txt` record an earlier incident/RLS test state, while `RESULTS.md` records the later post-fix state after migrations 110/111. This is not a defect in the delivered source by itself; it is an audit-trail ordering issue. The package therefore does **not** label the evidence archive as an unconditional certification.

## Commercial claims permitted by this release

The seller may state that the release is a commercial source package with documented security controls, deterministic source kernels, and current static source-tree verification. Historical reference-environment evidence dated 2026-09-25 and predecessor-tree CI evidence dated 2026-09-28 should remain explicitly labelled as historical. The seller should not state that this exact reconciled archive is universally production-certified, universally vulnerability-free, or validated against every buyer's infrastructure.

## Source-level additions in the 2026-10-07 handoff

- Canonical end-to-end reality trace and explicit ambiguity handling.
- Previously deferred department KPIs closed against persisted schema sources, including First-Time-Fix tracking and exact millimetre reel conservation.
- Planned/field/as-built GIS reconciliation.
- Explicit call/ticket/service/incident/asset correlation graph.
- Generic encrypted offline operation envelope with server-authority tenant boundary and idempotency.
- Optical evidence provenance gate and explicit recovery reauthorization.
- Static API authorization, security-surface, performance-resource and commercial-consistency gates.

All remain source-level evidence until exact-head CI/runtime admission.

## Acceptance before production

Before production go-live, the buyer should complete and retain evidence for PostgreSQL/RLS, OIDC/JWKS, TLS/ingress, secrets, backup/restore, rate limiting, external adapters, and the production attestation contract.

## Capability delivery 2026-10-15 (revision, not a new product version)

Product version stays `1.0.0-rc.1+commercial.2026-09-25`; this is a source revision to the same candidate.

**Changelog — the eleven capabilities formerly classified `UNIMPLEMENTED` are now implemented in source:**

| id | code | unit/API test | declared surface |
|---|---|---|---|
| `architecture` | `services/api/src/capabilities/architecture.cjs` | `services/api/test/capabilities/architecture.test.cjs` (3 cases) | `GET /v1/capabilities/architecture` |
| `theory-guide` | `services/api/src/capabilities/theory-guide.cjs` | `...(4 cases)` | `GET /v1/capabilities/theory-guide` |
| `ar-scanner` | `services/api/src/capabilities/ar-scanner.cjs` | `...(4 cases)` | `GET /v1/capabilities/ar-scanner` |
| `energy-analytics` | `services/api/src/capabilities/energy-analytics.cjs` | `...(5 cases)` | `GET /v1/capabilities/energy-analytics` |
| `cross-project` | `services/api/src/capabilities/cross-project.cjs` | `...(4 cases)` | `GET /v1/capabilities/cross-project` |
| `reputation-index` | `services/api/src/capabilities/reputation-index.cjs` | `...(4 cases)` | `GET /v1/capabilities/reputation-index` |
| `business-weather` | `services/api/src/capabilities/business-weather.cjs` | `...(3 cases)` | `GET /v1/capabilities/business-weather` |
| `enterprise-tm` | `services/api/src/capabilities/enterprise-tm.cjs` | `...(6 cases)` | `GET /v1/capabilities/enterprise-tm` |
| `constitution` | `services/api/src/capabilities/constitution.cjs` | `...(4 cases)` | `GET /v1/capabilities/constitution` |
| `self-improve` | `services/api/src/capabilities/self-improve.cjs` | `...(4 cases)` | `GET /v1/capabilities/self-improve` |
| `load-test` | `services/api/src/capabilities/load-test.cjs` | `...(4 cases)` | `GET /v1/capabilities/load-test` |

Shared: `services/api/src/capabilities/index.cjs` (registry) and `services/api/src/routes/capabilities.js` (authorize-gated route table that fails closed; 403 without authorization, 404 for unknown ids). Test totals: 12 suites, 51 cases, 0 failing, run with `node --test services/api/test/capabilities/*.test.cjs`.

**Registry state after this revision:** 106 capabilities = 55 `REAL`, 23 `ADVISORY`, 24 `VISION`, 4 `INTEGRATION_REQUIRED`, 0 `UNIMPLEMENTED`.

**What this revision does NOT change (release gates still open):** the production hold stays fail-closed; production Neon was not migrated by this revision; buyer-runtime attestation is still `NOT YET OBSERVED`; the 114-locale catalogue still reports 2 `verified` / 82 `machine-draft` / 30 `untranslated` with `humanCertified = 0`; `energy-analytics` still needs a real customer energy source, `reputation-index` and `business-weather` still need owner-supplied indicator definitions and sources, and `ar-scanner` still needs real iOS/Android field devices.
