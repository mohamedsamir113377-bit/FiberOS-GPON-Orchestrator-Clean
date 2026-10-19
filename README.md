> **Source/CI status checked 2026-10-18:** `main` head `aef4f50dab3440bf47f00c72a802859874f964aa` is green on exact-head GitHub Actions: source verification (892 tests, 0 failed, 0 skipped), migration sequencing/document alignment, manifest parity (1,381 files / 57,207,138 bytes), PostgreSQL/PostGIS RLS runtime, container security, source hygiene, website build, visual regression, i18n gate, truth-check, and release admission (run 39076331902, 2026-10-17T22:45Z). PR #74 (migration-191 reconciliation) was merged at 2026-10-17T22:16:43Z and is contained in `main`. Outstanding for commercial closure: prove a live Vercel production deployment linked to this repository (project `gpon-orchestrator` currently reports zero linked Git projects), then complete buyer-owned runtime acceptance per `FINAL_VERIFICATION_STATUS.md` and `docs/runbooks/BUYER_DEMO_DATA_SEED.md`. **Commercial delivery remains on HOLD until those runtime proofs are recorded.** Registry: 106 capabilities (55 REAL, 24 VISION, 23 ADVISORY, 4 INTEGRATION_REQUIRED); 114-catalog manifest: 2 verified, 112 machine-draft, 0 human-certified.

# FiberOS R14.1 — Sales Core

> **Current release truth:** see `FINAL_VERIFICATION_STATUS.md`. Historical audit records are retained under `docs/audit/history/` and are not current release evidence by themselves.

FiberOS is a multi-service FTTH/network-operations source distribution with a PostgreSQL/PostGIS persistence layer, API runtime, worker/AI/GIS services, field/operations web surfaces, security boundaries, and release-integrity controls.

## Repository entry points

- `apps/field-web/` — field-facing web surface.
- `apps/ops-web/` — operations/command web surface.
- `services/api/` — HTTP API and route boundary.
- `services/worker/` — background/outbox processing.
- `services/ai/` — AI service boundary.
- `services/gis/` — GIS service boundary.
- `packages/` — shared domain, security, database, adapters, assurance, and interface contracts.
- `sql/migrations/` — ordered production database migrations.
- `sql/bootstrap/` — database bootstrap/runtime-role setup.
- `scripts/` — migration, verification, buyer-acceptance, and release-integrity tooling.
- `config/` — capability, RLS-inventory, and runtime contract metadata.
- `docker/` — reproducible runtime container definitions.
- `.github/workflows/` — release admission and verification workflows.
- `i18n/` — canonical localization catalogs, locale metadata, and Weblate workflow assets. Static web pages carry only the canonical source/manifest plus the verified Arabic catalog under each app's `public/i18n/` directory so the standalone pages resolve their runtime i18n assets without duplicating all 114 catalogs.

## Application authorization boundary

See `docs/architecture/AUTHORIZATION_BOUNDARY.md` for the precise distinction between the reusable application authorization policy and the enforcement paths actually active in services/api.

## Release and truth boundaries

The repository deliberately separates source truth from external-environment evidence. Static verification can establish repository contracts; live PostgreSQL/PostGIS, OIDC/JWKS, customer infrastructure, vendor NMS, and other external integrations require their corresponding runtime/acceptance evidence.

The production migration chain is maintained in:

- `sql/migrations/PRODUCTION_MIGRATIONS.txt`
- `sql/migrations/PRODUCTION_MIGRATIONS.sha256`

The canonical sales-package inventory and per-file SHA-256 boundary is:

- `SALES_PACKAGE_MANIFEST.json`

## Local verification

After installing the repository dependencies with the supported Node.js version:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run verify
```

Useful focused gates:

```bash
npm run verify:capabilities
npm run verify:root-cause
npm run verify:domain
npm run verify:runtime-evidence
npm run verify:manifest
```

## Important evidence rule

A green static check does not certify external infrastructure. Do not treat a missing, unavailable, or pre-execution CI run as evidence that the application test suite passed.

## Buyer-facing documentation

- `BUYER_QUICKSTART.md` — buyer-oriented setup and first steps.
- `docs/commercial/SELLER_README.md` — commercial/source-distribution context.
- `SECURITY.md` — security model and operational boundaries.
- `docs/commercial/SALES_RELEASE_NOTES.md` — release-specific notes.
- `docs/runbooks/DEPENDENCY_DISCLOSURE.md` — dependency disclosure.
- `docs/runbooks/SOURCE_PROVENANCE.md` — source/provenance boundary.
- `docs/commercial/SALES_AGREEMENT_TEMPLATE.md` — transaction template.
- `docs/commercial/COMMERCIAL_RELEASE_STATUS.md` — release/evidence status and buyer acceptance boundary.
- `docs/commercial/COMMERCIAL_LICENSE_NOTICE.md` — online commercial license and archive rights boundary; checkout terms and selected license tier control licensing.
- `docs/architecture/DOCUMENT_AUTHORITY.md` — identifies current commercial documents versus historical engineering records.
- `docs/runbooks/IP_OWNERSHIP_DECLARATION_TEMPLATE.md` — ownership declaration template.

For authoritative behavior, prefer the executable source, migrations, verification scripts, and generated manifest over descriptive marketing text.

## Commercial reseller package

The repository includes controlled commercial documentation for a proposed multi-buyer / white-label model:

- `docs/commercial/RESELLER_COMMERCIAL_PACKAGE.md` — reference USD 3,500 commercial package and reseller rights boundary.
- `docs/runbooks/SUPPORT_POLICY.md` — standard 14-day technical support scope.
- `docs/commercial/WHITE_LABELING_GUIDE.md` — buyer-visible branding workflow without blind source replacement.
- `docs/commercial/FIVE_MINUTE_BUYER_DEMO_SCRIPT.md` — recording script for the interactive buyer demo.
- `docs/commercial/COMMERCIAL_DELIVERY_CHECKLIST.md` — final pre-delivery controls.

These documents support the online commercial transaction. The accepted checkout terms and selected license tier control the actual rights, support term, price, and legal obligations; a separate agreement may expressly modify them.

## Static website (Netlify)

Buyer Nexus and demo HTML surfaces from the FiberOS Website package are included under `apps/*/public/`.

```bash
npm run website:build
npm run website:check
npm run website:performance
```

`website:build` generates `.netlify/site`; run `website:check` and `website:performance` after the build. The earlier static-only audit did not run these commands; the current exact-main CI subsequently passed website build/Lighthouse budgets and visual regression. Optional public `FIBEROS_API_BASE` only — never secrets. On Vercel, keep this variable unset unless the deployed CSP is deliberately configured for the exact API origin; the current Vercel policy allows only same-origin connections. See `NETLIFY_DEPLOYMENT.md` and `docs/status/WEBSITE_FEATURES_MERGE_2026-10-03.md`.
