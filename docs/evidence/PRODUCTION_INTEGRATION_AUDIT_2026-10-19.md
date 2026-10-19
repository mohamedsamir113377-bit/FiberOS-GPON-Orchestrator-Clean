# Production Integration Audit — 2026-10-19

## Purpose and truth boundary

This report records read-only observations and completed changes for the current `GPON-Orchestrator` repository head. Green static CI is not evidence of a live backend, live database migration, buyer-owned OIDC, Redis, KMS, object-storage, network-device, or backup/restore verification. `PRODUCTION_HOLD=true` must remain until the project’s buyer-owned production acceptance evidence is complete.

## Repository and production source parity

- Repository: `mohamedsamir113377-bit/GPON-Orchestrator` (private).
- Default branch: `main`.
- Verified current deployed SHA: `55c7679f92d4fbc888665ec63ac838752d0f7e69`.
- Vercel production deployment: `dpl_AXY8biErpUfDHPghzLKrgLMcq19C`, reported `READY`, target `production`, matching the same repo, `main`, and SHA.
- Public static site: `https://gpon-orchestrator-gold.vercel.app/`.
- Repository homepage metadata is aligned to that URL.
- `main` has no branch protection. GitHub returned 403 for private-repository branch-protection/ruleset APIs because this plan requires upgrade or public visibility. Keep repository private; do not use public visibility as a shortcut.

## Website smoke checks

Observed HTTP 200 on the verified domain for `/`, `/ops/`, `/field/`, `/customer/`, `/enterprise-command.html`, `/trust/`, `/robots.txt`, `/sitemap.xml`, and `/fiberos-api-config.js`. Both `robots.txt` and `sitemap.xml` refer to the current `gpon-orchestrator-gold.vercel.app` origin. Security headers observed include CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP, and CORP.

The public API config serves `window.FIBEROS_API_BASE=""`, and `GET /api/health` returns 404. Vercel is configured for the static build (`npm run website:build`, output `.netlify/site`) and has no API function/rewrite in `vercel.json`. The API is a separate long-running Node server (`services/api/src/server.js`) whose source health route is `/health`. Therefore browser-to-API integration and live API health are **not verified**. Do not set the API base to the static domain; deploy a real runtime API first, then configure the exact API origin and its narrow CSP/CORS allowlists.

## Neon database observations

- Neon project: `long-cloud-39180195`.
- Database: `neondb`; PostgreSQL `18.6`.
- Main branch: `br-crimson-haze-b7gode2a`.
- Main had 0 public application base tables, no `public.fiberos_migration_history`, no `fiberos_*` roles, no `auth` schema, and no installed `postgis`/`pgcrypto` extensions at the time of inspection. PostgreSQL advertises PostGIS `3.6.4` and pgcrypto `1.4` as available.
- Isolated test branch created: `audit-migrations-2026-10-19` (`br-nameless-sea-b7qd14k2`). The official role bootstrap and auth shim ran successfully there; PostGIS and pgcrypto were installed there. The test branch still has 0 application migration-history rows.
- Application migrations were **not applied** to main or the test branch. An attempt to move from bootstrap into application migrations was blocked by tool safety checks; no workaround was used. Re-check the test branch before any authorized future attempt.
- The CI migration/RLS workflow passed on the current main SHA against its ephemeral CI database. That result does not establish Neon main migration success.

## Legacy Supabase signal

The exact main SHA also contains a green `Supabase Preview` check created by the Supabase GitHub App and pointing to an older project ref beginning `vxrqd`. The application/config scans did not find a direct `supabase.co` endpoint or Supabase client package in the app services, and the GitHub repository webhook inventory was empty. The third-party GitHub check remains configured; it was not removed or interpreted as proof of Neon use.

## CI checks verified on current main SHA

The following named checks completed successfully for `55c7679f92d4fbc888665ec63ac838752d0f7e69`: source `verify`; PostgreSQL 18.6/PostGIS 3.6 migration and RLS gate (ephemeral CI); final release admission; runtime container security gates for API, worker, AI, and GIS; source-hygiene; website build/performance gate; visual regression; truth check; plus the explicit manual `verify` and `database-migrations` workflows. This is source/CI evidence only, not live production-runtime certification.

## Required next actions before claiming commercial operational readiness

1. Decide and provision the backend runtime for the four Docker services using `docker/Dockerfile.runtime` and the repository deployment checklist; obtain a real API origin.
2. Apply the 196 ordered migrations to the isolated Neon test branch through the repository’s official `scripts/migrate.js` workflow using a separately authorized migrator credential. Confirm checksum history, final migration, PostGIS, RLS/FORCE RLS, role grants, tenant-isolation tests, and runtime gate. Do not run application migrations on main until the clean test succeeds and a reviewed cutover plan exists.
3. Configure `FIBEROS_API_BASE` only after a real API is deployed; add the API origin explicitly to the exact CSP `connect-src` and CORS allowlists; smoke-test public and authenticated paths.
4. Resolve the legacy Supabase GitHub App check at the account integration level if it is no longer needed; repository webhook deletion cannot remove an app-installed check.
5. Either upgrade GitHub so `main` protection and required checks can be enforced on this private repository, or document an equivalent authorized enforcement control. Do not make the repo public just for branch protection.
6. Keep `PRODUCTION_HOLD=true` until all required buyer-owned live attestation/probes pass. Never claim “zero defects” or “100% production ready” from static CI alone.
