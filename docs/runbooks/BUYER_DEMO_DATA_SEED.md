# Runbook — Buyer Demo Data Seed (safe, synthetic)

Purpose: give the buyer a reproducible, privacy-safe demo/seed dataset and a live
FTTH tenant-isolation exercise, using the exact sanctioned patterns that already run
in the hosted PostgreSQL/PostGIS RLS runtime gate. No customer PII, no production
data reuse, no guessed identifiers.

## Sources of truth (do not invent parallel fixtures)

1. `scripts/buyer-acceptance/live-postgres-rls.js` — `adminSeed()` inserts the full
   synthetic FTTH scenario (2 tenants, 2 users, 2 technicians, tickets, network asset,
   call session, conversations/messages, invoices) with fixed UUID constants and
   `.invalid` emails, `ON CONFLICT DO NOTHING` (idempotent), then exercises RLS
   isolation and lifecycle guards.
2. `scripts/buyer-acceptance/ftth-audit-rls-semantic-audit.js` — `seedFixtures()`
   for the audit-oriented subset (`public.tenants`, `auth.users`, ...).

## Prerequisites

- Roles/credentials created per `sql/bootstrap/00_production_roles.sql` and
  `sql/bootstrap/20_runtime_role_grants.sql` (migrator/runtime/worker separation).
- Environment: `RUNTIME_ADMIN_DATABASE_URL` (owner/migrator credential, session-level
  seeding with `row_security = off`) and `RUNTIME_APP_DATABASE_URL` (runtime
  credential used by `withPrincipal`).
- Node 24 per `.nvmrc`; PostGIS present (migrations 001–191 applied).

## Procedure

1. Isolated first pass (recommended): create a Neon branch from `production`
   (e.g. `demo-seed-<date>`) and point both env URLs at that branch.
2. Run the sanctioned exercise:
   `node scripts/buyer-acceptance/live-postgres-rls.js`
   Expected: all assertions pass — cross-tenant SELECT/UPDATE/INSERT blocked by RLS,
   lifecycle transitions enforced, tenant context via `withPrincipal`/claims only.
3. Buyer-facing demo surfaces then read the seeded synthetic tenants only.
4. Optional production demonstration requires buyer approval, and uses the same fixed
   UUIDs so rows are explicitly removable afterwards (documented constants in the
   script header).
5. Record date, commit SHA, branch/URL and assertion results in
   `FINAL_VERIFICATION_STATUS.md` (history section).

## Prohibited

- Loading real customer/PII data for demos.
- Bypassing RLS outside the script's transaction-scoped, rolled-back probe sessions.
- Editing fixtures without regenerating the acceptance contract (`npm run verify`).
