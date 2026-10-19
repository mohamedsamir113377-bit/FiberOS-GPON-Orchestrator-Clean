# FiberOS R14.1 — Buyer Quickstart

## What this package is

`FiberOS R14.1 — Sales Core` is a **Commercial Release Candidate** source distribution for a field-service / operational foundation with multi-buyer positioning and optional sector-specific optical capabilities. The repository includes its database schema and production migration chain; it is not a blanket certification of a buyer's production environment.

The authoritative seller verification record is [`FINAL_VERIFICATION_STATUS.md`](FINAL_VERIFICATION_STATUS.md), updated **2026-10-06** against source-tree version `1.0.0-rc.1+commercial.2026-09-25`; it distinguishes local source checks from pending CI and external production evidence. Buyers must still execute environment-specific acceptance before go-live.

## Requirements

- **Node.js `24.21.0` is the pinned buyer baseline.** The package engine accepts `>=24.21.0`, `.nvmrc` pins `24.21.0`, and `.npmrc` enables `engine-strict=true`; older Node versions are intentionally unsupported.
- PostgreSQL 18.6+ with PostGIS 3.6.x for full database-backed operation.
- A real OIDC provider exposing JWKS for production identity verification.
- TLS/HTTPS ingress controlled by the buyer.
- A protected secret/configuration mechanism for runtime credentials.

## Application authorization boundary

`packages/security/src/authorization.js` is the canonical reusable policy model and `services/api/src/authorizationMiddleware.js` actively enforces application-role admission on protected HTTP paths. Fine-grained resource/self/tenant/lifecycle authority remains in route handlers and PostgreSQL/RLS. See `AUTHORIZATION_BOUNDARY.md`.

## Database setup

1. As a controlled database administrator, run `sql/bootstrap/00_production_roles.sql`.
2. Set `NODE_ENV=production` and provide **only** `MIGRATOR_DATABASE_URL` to `npm run migrate`.
3. Run `npm run migrate` to apply production migrations `001`–`170`. Migration 124 deliberately fails if historical command decisions have no authoritative tenant attribution; do not bypass that guard.
4. After migrations complete, run `sql/bootstrap/20_runtime_role_grants.sql`.
5. Configure API/GIS with the dedicated runtime credential and the worker with its separate worker credential.
6. Do not place migration credentials in application containers.



## Production deployment (buyer-owned)

For a controlled go-live path (roles → migrate → grants → OIDC → Redis → hold release), follow:

[`docs/runbooks/PRODUCTION_DEPLOYMENT_CHECKLIST.md`](docs/runbooks/PRODUCTION_DEPLOYMENT_CHECKLIST.md)

Static website surfaces (Netlify or equivalent) are the browser layer only and do not certify API, database, or identity readiness.

## Minimum environment boundary

Start from `.env.example`. Production identity requires real OIDC/JWKS values. Database TLS verification is enabled by default in the supplied production compose/runtime configuration.

## Domain mode

Default positioning is multi-buyer / domain-neutral. Set `FIBEROS_DOMAIN_MODE` to a sector value only when intentionally enabling the sector-specific optical surfaces. Run `node scripts/verify-domain-neutrality.js` to verify the chosen mode.

## Verification

Run, at minimum:

```bash
npm ci
npm test
npm run verify
npm run verify:commercial
```

The seller/reference evidence is described in `COMMERCIAL_RELEASE_STATUS.md`; it must not be substituted for buyer-side acceptance.

## Honesty boundaries

- The package does not claim universal production certification.
- JWT organization claims are advisory; enforced tenant isolation is database-backed.
- The built-in rate limiter is PROCESS_LOCAL and must not be treated as a shared multi-instance limiter.
- Production hold remains fail-closed until live buyer-owned attestation is supplied.

## White-label / reseller setup

Follow `WHITE_LABELING_GUIDE.md`. Do not rename API route names, database roles, migration files, environment variables, or security identifiers as a cosmetic rebrand. Reseller and source rights are controlled by the signed agreement.

## Support baseline

The reference commercial proposal includes 14 calendar days of technical support. See `SUPPORT_POLICY.md` and the signed agreement for the actual scope and dates.


## Current 2026-10-03 extension
See [`docs/status/DEEP_FIELD_OPERATIONS_INTELLIGENCE_2026-10-03.md`](docs/status/DEEP_FIELD_OPERATIONS_INTELLIGENCE_2026-10-03.md) for the four deep field-operations additions and their explicit acceptance boundaries.
