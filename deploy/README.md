# FiberOS R14.1 — Deployment, database and localization execution package

This directory contains the shipped deployment contracts and fail-closed validation tools. Historical runtime evidence is explicitly separated from the current package contract.

## Current package contract

| Layer | Current state |
| --- | --- |
| PostgreSQL/PostGIS baseline | **PostgreSQL 18.6 / PostGIS 3.6.x** via `postgis/postgis:18-3.6` |
| Base DB compose | Development/local DB boundary; PostgreSQL TLS is disabled there because no private certificate material is shipped |
| Production TLS | Explicit `docker-compose.tls.yml` override; operator supplies `server.crt` and `server.key` through Docker secrets |
| Migrations | **001–196** production migration chain, with checksum manifest |
| i18n | **114 catalogs / 101 runtime keys — 2 status objects (`ar` verified + `en` source mirror), 82 machine-draft, 30 intentionally untranslated** |
| Translation compose | Validation-only; no translation engine or model checkpoint is claimed as bundled |

## Historical evidence boundary

A previous deployment evidence run used PostgreSQL 16.15. That evidence is retained as historical engineering evidence only; it does **not** satisfy the current PostgreSQL 18.6 production baseline. The source package therefore keeps `productionReadyClaim=false` until the declared runtime boundaries are exercised on the current baseline.

## Files

```text
deploy/
  docker-compose.base.yml             # PostgreSQL 18/PostGIS 3.6 development DB layer
  docker-compose.app.yml              # application layer; uses operator-provided Docker secrets
  docker-compose.tls.yml              # production PostgreSQL TLS override
  docker-compose.translation.yml      # translation artifact validation only
  nginx/field-web-security-headers.conf # HSTS/CSP/referrer/camera/GPS headers for field-web
  nginx/ops-web-security-headers.conf   # HSTS/CSP/referrer/camera/GPS headers for ops-web
  SECRETS_SETUP.md                    # required operator-supplied secret/certificate setup
  sql/00_roles_grants_hardening.sql   # post-migration role/RLS hardening; run explicitly after migrations
  tests/tenant_isolation.sh           # tenant-isolation checks
  .env.example                        # non-secret environment template

tools/
  generate-locale-manifest.js         # derives the 114-locale manifest from actual files
  validate-translation.js             # translation contract validator
  surgical-translator-validator.js    # deterministic structural translation validator
  build-translation-queue.js          # fail-closed translation queue builder

i18n/
  models.json / models.schema.json    # model registry; no bundled provider checkpoint is claimed
```

## Database bootstrap order

`docker-compose.base.yml` intentionally does **not** mount `deploy/sql` into PostgreSQL `initdb`: `deploy/sql/00_roles_grants_hardening.sql` is a post-migration hardening assertion and must run only after role/bootstrap setup and the complete migration chain. This prevents a fresh database from executing a post-migration security assertion before its target objects exist.

## Runtime truth boundary

Static source checks do not certify live OIDC/JWKS, PostgreSQL/RLS, routing, telemetry/NMS/OTDR, object storage, KMS/HSM, or messaging behavior. Those boundaries remain runtime verification prerequisites and are intentionally fail-closed.

## Web-console security requirements

- Include `nginx/ops-web-security-headers.conf` in the TLS server block serving `apps/ops-web/public`, or configure the static host to honor `apps/ops-web/public/_headers`. HSTS is effective only when the console is served over HTTPS.
- The console defaults to same-origin API traffic. For a separate API origin, add only its exact HTTPS origin to `apps/ops-web/public/ops-config.js` **and** to `connect-src` in both HTML CSP meta tags, `apps/ops-web/public/_headers`, and the Nginx header include. These four CSP declarations must contain the exact origin, never the `https:` scheme wildcard. The JavaScript policy separately rejects unlisted origins, credentials in URLs, unsafe API paths, and redirects before adding the session bearer token.
- `session-auth.js` accepts a pre-issued JWT from the organization's identity provider and stores it only in the current tab's `sessionStorage`; it does not implement an interactive OIDC sign-in or issue credentials. Configure and operate the identity provider separately.
- The operations console intentionally does not load third-party scripts or OCR from a CDN. OCR is provided by the dedicated Field-Web application, which packages its OCR engine and language data locally.

## Redis high-availability admission

When `SECURITY_RATE_LIMIT_BACKEND=REDIS`, production admission requires a signed `fiberos.redis-ha-proof.v1` file, a separately mounted trusted Ed25519 public key, and the expected key ID pinned in deployment configuration. The readiness gate verifies the signature and recent failover record, then connects to the configured Redis endpoint and issues `ROLE`; admission fails unless the endpoint is a primary with at least one connected replica. Keep the proof file and trust key on separate deployment-control paths; do not treat the example JSON or self-authored booleans as evidence. Redis rate limiting remains fail-closed when the store is unavailable.
