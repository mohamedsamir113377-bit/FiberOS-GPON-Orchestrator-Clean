# FiberOS R14.1 — Commercial Release Receipt

- Product: `FiberOS R14.1 Sales Core`
- Version: `1.0.0-rc.1+commercial.2026-09-25`
- Status: `RELEASE HOLD — BUYER-RUNTIME AND DELIVERY-ARCHIVE ADMISSION REQUIRED`
- Read-only Neon Production evidence (2026-10-17): `public.fiberos_migration_history` contains **196 records** through `196_narrow_app_technician_read_scope.sql`; its recorded SHA-256 `8d1dc04c47842953b4189e75fec44170317b6b8c753b3852a8100efa0b41b40b` matches the source checksum ledger. The live `event_outbox_contract` trigger executes `ecl_capture('event_id')`, and 10 non-internal `t_ecl_*` triggers are active. The previously recorded `m190-apply-test-20261017` fixture smoke test ran on a separate test branch before migration 196 and remains historical test-branch evidence only; it is not proof of post-196 production writes or chain validation. No write was made to production.
- Runtime baseline: `Node 24.21.0; PostgreSQL 18.6+; PostGIS 3.6.x; OIDC/JWKS RS256`
- Reference list price: `USD 3,500`
- Current online campaign price: `USD 3,000`
- Standard support proposal: `14 calendar days`
- Current delivery archive SHA-256: **not published yet; it must be recorded in the external release sidecar after the admitted archive is built**

<!-- BEGIN GENERATED:release-provenance -->
- Generated manifest scope on this source tree: **1,393 manifest-tracked entries / 57,567,318 bytes** (the manifest self-entry is excluded from the byte total).
- Production migration chain: **001–196**; product version: **1.0.0-rc.1+commercial.2026-09-25**.
- Rendered from `SALES_PACKAGE_MANIFEST.json` by `scripts/release-provenance.js`; `--check` fails closed on any drift between the tree, the manifest and this document.
<!-- END GENERATED:release-provenance -->

## Current reconciliation basis

The exact admitted source commit must be recorded by the GitHub release reference and by `MANIFEST_BUILD_STAMP.txt` inside the delivered archive. The source-tree manifest records the exact current file and byte totals; this candidate is not yet admitted for delivery.

The archive digest is intentionally not embedded as a self-referential value inside the source archive. After CI admission produces the delivery archive, publish the matching sidecar named `<archive>.sha256` with the release asset and record that same external sidecar in the public verification record.

## Static and local evidence

The 2026-10-14 verification executed the local source and website gates on this consolidated tree. `npm run verify` passed (884 tests: 884 passed, 0 failed, 0 skipped); website build and hardened-header verification passed (33 required files). The delivery archive builds and verifies from this tree. These results do not certify live production infrastructure.

**Historical snapshot (2026-10-11):** the fix branch then reported 851 tests (850 passed, 0 failed, 1 skipped) and still awaited its hosted PostgreSQL/PostGIS gate. This was superseded by the 2026-10-13 exact-main closeout: source verification passed 884/884 tests, hosted PostgreSQL/PostGIS/RLS and release-admission gates passed, migration 187 was verified in Neon production, and Vercel production is `READY` on main SHA `a6c55b5638e3f11f5b8043ec727b27797f7eae57`. Buyer-specific certification remains false until separate buyer evidence is accepted.

- Local verification: **PASS per PR #55 report** (`npm run verify`, exit 0; 884/884 tests). Local results do not equal hosted admission.
- Hosted CI: **NOT PASSED / cause unresolved**. Five PR #55 workflows failed in 2-6 seconds; no job steps were returned and logs were not retrievable. A billing/spend-limit message was reported, but the run API does not prove that cause.
- Hosted PostgreSQL/RLS on candidate `9dc3b4f`: **NOT VERIFIED**. Migration 189 has not passed a retained isolated live DB run; no production migration was applied.
- Clean install: prior evidence is historical; this receipt does not record a new `npm ci` result for candidate `9dc3b4f`.
- Source chain: **001-196 in source**; the latest cited Neon production read ends at 187 (2026-10-13). Migrations 188-196 are not attested as applied to production.
- Adversarial DB audit: **PASS / STATIC ONLY** (168 tenant-sensitive tables; `productionCertification=false`); no live tenant-isolation claim.
- Pre-DB gate: **PASS per local report**. Migrations 125-128 still need current isolated DB semantic acceptance.
- Production console, root-cause contracts, JavaScript syntax and architecture gates: **PASS per recorded local verification**.
- i18n: **114 locale files; 1 verified, 113 structural placeholders**. Full translation acceptance is incomplete.
- Manifest/provenance and commercial consistency: **PASS per recorded local `npm run verify`**; hosted candidate admission is not passed.
- Website build/security headers: **PASS locally** (33 required files); live public deployment is not independently tied to candidate `9dc3b4f`.
- Browser performance and visual regression: **NOT VERIFIED on this exact candidate**; current-head runs remain required.
- PR #55 is open and unmerged. `main` remains `742e2e7b47bea2a3742d3c3c7dba73aa780c6198`; production remains on hold.
- Delivery archive: **NOT PUBLISHED**; no external SHA-256 sidecar exists. Do not issue a buyer download until they match.
- Review: [PR #55](https://github.com/codespine78-web/FiberNexus-1/pull/55) remains open; no merge or production write occurred yet.

## Test-suite evidence boundary
**Historical local snapshot (2026-10-12):** 866 tests passed at that point. The later exact-main hosted source run on 2026-10-13 passed 884 tests with 0 failures; hosted PostgreSQL/PostGIS/RLS, migration sequencing (on the code-bearing merge SHA), release admission, build/performance, and visual gates passed for the current release head and code-bearing baseline. This still does not prove the buyer's own live IdP, Redis, storage, KMS/HSM, vendor adapters, populated-tenant workflow or signed go-live acceptance. The commercial release therefore remains on hold.
## Buyer evidence boundary

A buyer-facing verification repository may publish the exact admitted archive SHA-256, this verification record, and the static gate results without publishing product source. It must not claim that the current archive is releasable until current CI admission succeeds and the release sidecar has been generated from that exact archive.

The source archive remains the controlled commercial delivery. External infrastructure and buyer-owned production certification remain outside the static release boundary.

## receipt note 2026-10-15

Source revision: the eleven former `UNIMPLEMENTED` capabilities are implemented
(`services/api/src/capabilities/*.cjs` + `services/api/test/capabilities/*.test.cjs`, 51 cases, 0 failing),
with declared surfaces `GET /v1/capabilities/<id>`. Registry: 55 `REAL` / 24 `VISION` / 23 `ADVISORY` /
4 `INTEGRATION_REQUIRED` / 0 `UNIMPLEMENTED`. Product version, price, and the `RELEASE HOLD` status are
unchanged: delivery-archive admission and buyer-runtime certification remain pending.
