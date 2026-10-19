# Security Policy — FiberOS R14.1 Sales Core

## Security posture

## Current source posture — 2026-10-17

Current exact-head review status (2026-10-17): `main` remains at base SHA `2527d64754766ab530650648cb1e25da03a52662`; review PR #74 is testing the migration-191 reconciliation on its own branch. The latest observed candidate run `39047040317` passed the source test suite (891 passed, 0 failed, 0 skipped), migration sequence/document alignment, source hygiene, PostgreSQL/PostGIS RLS runtime, runtime-container image checks, website build and visual regression. Release admission remains **FAILED / HOLD** because the manifest parity gate still sees 1,391 tracked entries versus 1,390 declared and stale per-file hashes; the final provenance generation and exact-head admission must pass before delivery. These are source/ephemeral-CI facts, not buyer-production certification.

The 2026-10-16 `net-snmp@3.29.1` / SBOM mismatch is resolved on this base: `package-lock.json` resolves `net-snmp@3.29.2` with SHA-512 integrity metadata, `SBOM.cdx.json` includes version `3.29.2`, and the high-severity production dependency audit passed. This does not prove that every dependency is free of vulnerabilities.

Read-only Neon Production inspection on 2026-10-17 now reports 196 records through `196_narrow_app_technician_read_scope.sql`. The stored SHA-256 for migration 196 is `8d1dc04c47842953b4189e75fec44170317b6b8c753b3852a8100efa0b41b40b`, matching the current source checksum ledger. The live `event_outbox_contract` trigger definition is `ecl_capture('event_id')`, as required by the table's primary key; 10 non-internal `t_ecl_*` triggers are active (migration 196 corrected the existing trigger rather than adding an eleventh). This evidence is read-only and does not certify a live business-write/hash-chain exercise or buyer production.

The connected Vercel team context currently returns zero projects and no published GitHub Release or external archive SHA-256 sidecar was found. Current public deployment/source parity is therefore **unverified**. Release remains on HOLD pending safe ECL remediation, confirmed deployment/source parity, and buyer-runtime acceptance.


## Historical 2026-10-16 pre-CI audit snapshot (superseded where noted above)

The consolidated source baseline `3671a25820094f71e69d963b87bf5a857b038ce4` has not been re-certified by a new hosted CI run in this audit pass. The source-only review found unresolved issues in migration 188's audit-chain implementation (actor omitted from the hash, non-canonical timestamp hashing, and no business-table capture triggers created by the migration) and a lockfile/SBOM mismatch (`net-snmp@3.29.1` in `package-lock.json`, with no matching component in the checked-in SBOM). See [the detailed pre-CI audit](docs/audit/PRE_CI_STATIC_AUDIT_2026-10-16.md).

These findings are blockers to claiming the migration's audit trail is complete or the dependency inventory is verified clean. No production migration was executed and no production deployment was changed. The migration chain being present through 189 in source is not evidence that migration 188 or 189 has been applied and validated in Neon Production.


This is a **Commercial Release Candidate** source distribution. A seller/reference environment was tested on 2026-09-25 against Node 24.21.0, PostgreSQL 18.6, PostGIS 3.6.4, OIDC/JWKS, TLS, and dependency scanning. The evidence is a point-in-time engineering verification record, not a certification of a buyer's production environment.

## Release-security boundary

The controlled buyer delivery is a version-pinned source archive identified by SHA-256 and accompanied by commercial/security documentation. Buyer-visible demos remain presentation assets and must never be used as proof of live database isolation, identity-provider validation, uptime, or production readiness.

## Verification boundary

The release includes source-level verification and seller/reference-environment evidence. Customer production still requires buyer-side validation of tenant isolation, identity provider, TLS/ingress, secrets, backup/restore, rate limiting, external integrations, and live production attestation.

The external evidence set contains historical pre-fix records and later post-fix results. Some retained records describe the historical `111_incident_guard_trusted_admin_path.sql` state; keep them as an audit trail, not as current certification. Migration 124 and 125 descriptions in older evidence are historical scope notes and must not be treated by themselves as proof that a current candidate or a buyer deployment has passed. For the 2026-10-16 source snapshot, the remaining source finding was the Migration 188 audit-chain gap documented in `docs/audit/PRE_CI_STATIC_AUDIT_2026-10-16.md`. The current inspected production ledger and unresolved capture-trigger/actor/hash boundary are recorded in the current source posture at the top of this file.

## Database release gate

The production migration chain in this candidate is `001-196`. Release integrity requires:

1. checksum-verified production migrations `001-196`;
2. PostgreSQL 18.6+ with PostGIS 3.6.x;
3. runtime grants applied after migrations;
4. RLS/FORCE RLS and tenant-boundary acceptance;
5. incident/ticket lifecycle authority tests;
6. tenant attribution for command-decision records must fail closed when no authoritative tenant can be resolved;
7. current runtime evidence must match the exact candidate commit and environment;
8. evidence retained without relabeling it as buyer-production proof.

## Rate limiting

The application request rate limiter remains `PROCESS_LOCAL` unless a separately configured Redis-backed rate-limit store is provisioned. This is distinct from the required distributed replay defense: production replay protection uses Redis `SET NX EX` and fails closed when Redis is unavailable.

## Authorization boundary

Protected HTTP paths use canonical application-role admission middleware. Fine-grained resource/action, ownership, tenant, lifecycle, and database authority remains in the handler and PostgreSQL/RLS layers. See `AUTHORIZATION_BOUNDARY.md`.

## Reporting a security issue

For a private commercial delivery, security reports should be sent to the rights holder using the contact details in the executed agreement. Do not publish sensitive vulnerability details before coordinated remediation.

## Distributed Replay + Interactive OIDC boundary (R14.1 hardened)

Protected mutating routes require a client-supplied `X-Idempotency-Key` when the distributed replay boundary is enabled. In production the replay backend is Redis and the reservation uses atomic `SET NX EX`; Redis loss fails closed. A successful reservation is retained for the configured TTL rather than deleted after response completion, preventing the same operation from being replayed immediately.

The ops-web interactive login uses server-side OpenID Connect Authorization Code + PKCE. The browser receives only an HttpOnly session cookie and a CSRF token for subsequent mutation requests. OIDC client secrets and provider tokens remain server-side; the static web application does not persist or paste bearer JWTs.

Redis HA readiness evidence is bound to the deployment resource identifier and CI/CD build reference. A signed proof that belongs to another resource or build is rejected before runtime topology probing.

## Application firewall (HTTP edge)

Package `packages/security-firewall` is evaluated on every API/AI/GIS request before route handlers:

- Path traversal / null-byte rejection
- HTTP method allow-list (blocks TRACE/TRACK/CONNECT)
- Scanner probe paths (`.env`, `.git`, `wp-admin`, …)
- Body size and content-type limits
- Production HTTPS enforcement (trusted proxy CIDR only)
- Optional `SECURITY_ALLOWED_HOSTS` and `SECURITY_FIREWALL_DENY_CIDRS`
- Complements rate limiting, CORS, security headers, Redis replay defense, and PostgreSQL RLS

Static website surfaces use Netlify `_headers` CSP/HSTS/COOP (see `scripts/build-netlify-site.js`); they are not a substitute for the API firewall.

## Application-layer DDoS / flood control

Volumetric network DDoS (L3/L4) must be mitigated at the **edge** (CDN, cloud WAF, or provider Shield). FiberOS does not claim to absorb multi-Gbps floods in-process.

In-process controls (package `packages/security/src/ddosGuard.js`):

- Concurrent request limit **per source IP** (`SECURITY_DDOS_MAX_CONCURRENT_PER_IP`)
- Concurrent request limit **process-wide** (`SECURITY_DDOS_MAX_GLOBAL_CONCURRENT`)
- Complements rate limiting (`SECURITY_RATE_LIMIT_*`), the application firewall, body/header bounds, and Redis replay defense

Tune limits to buyer capacity; fail-open is never the default when the guard is enabled.

## Volumetric (L3/L4) DDoS

Multi-Gbps network floods are **out of process scope**. Buyers must place a CDN/cloud DDoS service in front of the origin. See:

- [`docs/runbooks/VOLUMETRIC_DDOS_EDGE_PROTECTION.md`](docs/runbooks/VOLUMETRIC_DDOS_EDGE_PROTECTION.md)
- [`deploy/nginx/api-edge-ddos.conf`](deploy/nginx/api-edge-ddos.conf) — HTTP connection/request limits at the reverse proxy

FiberOS ships in-process concurrency and rate limits only after traffic is accepted by the host.


## Production-hold honesty boundary

The production hold is a documented-evidence gate, not a cryptographic control. An operator with filesystem write access can lift it by writing `config/production-readiness-attestation.json`. The hold guarantees that no deployment claims production readiness without an explicit live-evidence attestation; it does not prevent a privileged operator from asserting one. Buyers must protect filesystem and deployment write access accordingly.


## 2026-10-07 static hardening addendum

Source-level hardening now also includes bounded end-to-end trace resolution, planned/field/as-built GIS reconciliation, explicit call/incident correlation, generic offline operation envelopes, optical evidence provenance validation, and interrupted-control reauthorization. These additions do not replace runtime proofs for PostgreSQL/RLS, identity, provider integrations, KMS/HSM, devices, or buyer infrastructure.
