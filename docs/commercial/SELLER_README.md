# FiberOS R14.1 — Sales Core Source

> **Commercial Release Candidate — controlled source distribution.**
>
> **Version:** `1.0.0-rc.1+commercial.2026-09-25`
> **Production migration chain:** `001–196`

## Commercial position

The release is suitable for online commercial licensing, deployment, and white-label delivery under the published license and applicable order terms. Seller/reference-environment verification evidence dated 2026-09-25 exists for Node 24.21.0, PostgreSQL 18.6/PostGIS 3.6.4, RLS/tenant boundaries, OIDC/JWKS, TLS, and dependency scanning. It is not a blanket certificate for a customer's production environment.

## What the buyer receives

- Operational API, worker, GIS, and AI service source.
- Runtime implementation packages under `packages/*`.
- PostgreSQL/PostGIS production migrations `001` through `176`.
- Production database role bootstrap and runtime grants.
- Browser operational surfaces for field and operations users.
- i18n runtime structure and disclosed locale coverage.
- Environment templates and runtime configuration contracts.
- Database migration and health-check entrypoints.
- Security policy, dependency disclosure, CycloneDX SBOM, and source-provenance materials.
- Container runtime definition and deployment compose configuration.

## Commercial baseline

- Reference list price: **USD 3,500**.
- Current online campaign price: **USD 3,000** (USD 500 discount).
- Standard support proposal: **14 calendar days**.
- The standard online license permits commercial deployment and resale of deployed services/solutions.
- Standalone source redistribution and downstream master-reseller/source-sale rights are excluded unless an explicitly purchased tier or separate written agreement grants them.
- The seller remains free to sell or license the same release to other customers; the standard license is non-exclusive.
- Custom development and new external integrations are separately scoped unless expressly included.

## Runtime prerequisites

Node.js `24.21.0` is the pinned buyer baseline. The package engine declares `>=24.21.0`; `.nvmrc` pins `24.21.0`; `.npmrc` enables `engine-strict=true`. The database target is PostgreSQL 18.6+ with PostGIS 3.6.x.

## Authorization and database boundary

`packages/security/src/authorization.js` is actively consumed by the API authorization middleware for fail-closed application-role admission. Fine-grained ownership, tenant, lifecycle, and database authority remains enforced by the route/database path. The production migration chain `001–196` includes the latest incident-authority, tenant-integrity, installation-lifecycle, and public-tracking closures.

## Production hold

`packages/core/src/productionHold.js` remains fail-closed. `PRODUCTION_HOLD=false` cannot by itself establish production readiness. Production requires `FIBEROS_PRODUCTION_VERIFIED=true` plus a truthful live attestation covering the required controls.

## Security and evidence boundary

Static source inspection, local tests, and seller/reference verification do not certify the buyer's live infrastructure. Buyers must perform environment-specific checks for tenant isolation, identity, TLS, secrets, backups/restore, rate limiting, external adapters, and production attestation.

## Quickstart

See `BUYER_QUICKSTART.md`.

## Commercial/legal boundary

`docs/commercial/COMMERCIAL_PACKAGE_NOTICE.txt`, `docs/commercial/ONLINE_COMMERCIAL_LICENSE.md`, `docs/runbooks/IP_OWNERSHIP_DECLARATION_TEMPLATE.md`, `docs/commercial/COMMERCIAL_LICENSE_NOTICE.md`, and `docs/commercial/SALES_AGREEMENT_TEMPLATE.md` define the online-commercial baseline and transaction-support materials. No IP ownership transfer or exclusivity is implied by purchase.
