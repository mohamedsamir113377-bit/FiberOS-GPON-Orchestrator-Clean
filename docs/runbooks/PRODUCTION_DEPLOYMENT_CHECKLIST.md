# FiberOS R14.1 — Production deployment checklist (buyer-owned)

This runbook is the controlled path from a verified **sales-core** tree to a buyer-operated runtime.
Static CI success does **not** certify the buyer’s PostgreSQL, OIDC, Redis, TLS, or NMS.

**Pinned baseline:** Node.js `24.21.0`, PostgreSQL `18.6+`, PostGIS `3.6.x`, production migrations **`001-196`**.

---

## 0) Preconditions

- [ ] Source tree matches the commercial SHA / `SALES_PACKAGE_MANIFEST.json`
- [ ] `npm ci` on Node `24.21.0` (`engine-strict`)
- [ ] Secrets held outside git (vault / platform secrets)
- [ ] Copy `.env.example` → protected env store; replace every `REPLACE_ME` / `example` value

---

## 1) Database bootstrap

1. [ ] As cluster admin, apply `sql/bootstrap/00_production_roles.sql`
2. [ ] Confirm roles: `fiberos_owner`, `fiberos_migrator`, `fiberos_runtime`, `fiberos_worker`, `fiberos_app`, `fiberos_policy_reader`
3. [ ] Set **only** `MIGRATOR_DATABASE_URL` for migration work (`NODE_ENV=production`)
   Before migrations 184 and 185, if `sql/bootstrap/20_runtime_role_grants.sql` was already applied, have a DBA temporarily grant `fiberos_policy_reader` membership to `fiberos_owner` and `CREATE` on `public`. Migration 184 needs membership; migration 185 needs both. Each fails closed when required grants are absent. After migration completes, rerun `sql/bootstrap/20_runtime_role_grants.sql` as admin and verify both temporary grants are revoked.
4. [ ] Run `npm run migrate` (applies **001-196**)
5. [ ] On a clean installation, confirm history count = **196** and last = `196_narrow_app_technician_read_scope.sql`, matching the final entry in `sql/migrations/PRODUCTION_MIGRATIONS.txt`.
   On an existing database, inspect the actual history and checksum rows rather than imposing the clean-install count.
6. [ ] If command decisions already exist, resolve every legacy row from an authoritative tenant source before migration 124; the migration intentionally aborts on any unassigned row.
7. [ ] Apply `sql/bootstrap/20_runtime_role_grants.sql` as admin
8. [ ] Never mount migrator credentials into API/worker/ai/gis containers

---

## 2) Identity (OIDC / JWKS)

- [ ] `JWT_VERIFY=true`
- [ ] `OIDC_JWKS_URL`, `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_ALLOWED_HOSTS` point at the buyer IdP
- [ ] JWKS reachable over TLS from the API network path
- [ ] No HS256 shared-secret fallback in production

---

## 3) Redis (replay defense)

Production replay protection is **fail-closed** when Redis is required and unavailable.

- [ ] Provision Redis (HA recommended for multi-instance)
- [ ] Configure `FIBEROS_REPLAY_DEFENSE_BACKEND=REDIS` and related `FIBEROS_REPLAY_*` vars from `.env.example`
- [ ] Optional: set `FIBEROS_REDIS_TEST_URL` in CI to un-skip the token-bucket test
- [ ] For multi-instance rate limits, move off `PROCESS_LOCAL` only with a proven shared backend

---

## 4) Runtime services

Using `docker-compose.sales.yml` / `docker/Dockerfile.runtime` (or equivalent orchestrator):

- [ ] Build `SERVICE=api|worker|ai|gis` images
- [ ] API/GIS: `DATABASE_URL` = **runtime** role only
- [ ] Worker: `DATABASE_WORKER_URL` = **worker** role only
- [ ] `PG_SSL=true` and reject unauthorized certs in production
- [ ] `CORS_ORIGIN` locked to buyer web origins
- [ ] Security headers / HSTS / body limits as in `.env.example`

---

## 5) Static website (optional)

Browser surfaces only (Buyer Nexus, Ops, Field, Enterprise Command):

```bash
node scripts/build-netlify-site.js
# publish directory: .netlify/site
```

- [ ] Deploy via Netlify (GitHub app must include this **private** repo) or any static host
- [ ] Optional public `FIBEROS_API_BASE` only — **never** tokens or DB passwords in the site

---

## 6) Production hold release

Default posture is fail-closed:

- `PRODUCTION_HOLD=true`
- `FIBEROS_PRODUCTION_VERIFIED=false`

- [ ] Complete buyer attestation file referenced by `FIBEROS_PRODUCTION_ATTESTATION_FILE`
- [ ] Run `npm run verify:production-readiness` (or equivalent gate) against live config
- [ ] Only then clear the hold per commercial process

---

## 7) Acceptance probes (minimum)

- [ ] `npm test` and `npm run verify` on the delivered tree (static)
- [ ] Authenticated API health with real OIDC tokens
- [ ] Tenant isolation: Tenant-A cannot read/write Tenant-B rows
- [ ] Field close / evidence / billing routes reject replay when Redis is down (if required)
- [ ] Backup/restore drill for PostgreSQL

---

## Honesty boundary

Green CI on the seller repository proves **source + ephemeral CI database** behavior.
Buyer production remains the buyer’s responsibility: network, IdP, secrets, HA, monitoring, and legal acceptance.


### Source-level pre-freeze additions
- [ ] Operations-trace package included and covered by package-lock.
- [ ] GIS reconciliation package included and covered by package-lock.
- [ ] Contact-center correlation graph remains explicit/read-only/advisory.
- [ ] Offline operation envelope has no client tenant authority.
- [ ] Recovery requires explicit reauthorization.
- [ ] Static authorization/security/performance/commercial gates are wired into the final verification chain.
