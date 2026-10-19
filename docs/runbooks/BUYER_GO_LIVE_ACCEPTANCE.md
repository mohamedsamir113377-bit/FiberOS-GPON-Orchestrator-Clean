# Buyer go-live acceptance probes

After `docs/runbooks/PRODUCTION_DEPLOYMENT_CHECKLIST.md`:

## Static

```bash
npm ci
npm test
npm run verify
npm run verify:commercial
```

Expect contiguous migrations **001–196** and manifest parity.

## Live database

- On a clean installation, migration history count is **196**, with last migration `196_narrow_app_technician_read_scope.sql`.
- On an existing database, inspect the actual migration history and checksums; do not assume a clean-install count.
- Tenant-A cannot read Tenant-B rows
- Cross-tenant FK updates raise `TENANT_MISMATCH_*`

## Identity and Redis

- Real OIDC JWKS; invalid tokens rejected
- Replay-protected routes fail closed when Redis is required and unavailable
- Optional: `FIBEROS_REDIS_TEST_URL` for CI token-bucket test

## Website

```bash
npm run website:test
```

Static only — does not prove API/DB readiness.
