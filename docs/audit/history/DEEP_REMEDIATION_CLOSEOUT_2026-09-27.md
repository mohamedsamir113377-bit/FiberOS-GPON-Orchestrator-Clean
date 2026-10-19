# FiberOS R14.1 Deep Remediation Closeout

**Assessment date:** 2026-09-27  
**Scope:** The supplied FiberOS R14.1 source archive and its attached findings checklist.  
**Disposition:** Code-level defects with locally verifiable fixes were corrected and retested. This record is not a production deployment certification or a claim that external integrations were proven.

## Current verification record

- Runtime: Node.js 24.21.0.
- Database: PostgreSQL 18.6 / PostGIS 3.6.4 on a fresh disposable database.
- Production migration ledger: 114 migrations, ending at `114_remove_recursive_ticket_update_policy.sql`; the production migration SHA-256 ledger verified.
- `npm run verify`: 220 tests, 219 passed, 0 failed, 1 skipped; all other verification gates passed.
- `npm run verify:commercial`: passed for migration range 001-114.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- Redis integration test: 4/4 passed against a real local Redis service; separate limiter clients shared the same token bucket.
- Supply-chain baseline: the supplied archive already had 242 locked `node_modules` packages and 80 OpenTelemetry packages. Redis added 7 lock entries. The broad auto-instrumentation bundle was subsequently removed; the current lock has 145 `node_modules` packages, with explicit HTTP and PostgreSQL instrumentation only. The refreshed CycloneDX SBOM contains 141 components.
- Live PostgreSQL RLS/acceptance harness: passed (`ok: true`) against the disposable PostgreSQL 18.6 / PostGIS 3.6.4 database, including tenant isolation, technician supervisor scope, field-close persistence, ticket lifecycle authority/races, and payment-role rejection.

## Remediations recorded

1. Added Redis-backed atomic shared rate limiting with explicit production configuration, secret-file URL support, bounded connection behavior, and fail-closed handling. Updated API and AI services to await the shared limiter. The local process-only rate limiter remains valid only for a declared single instance.
2. Made production kernel-boundary mode an explicit `true`/`false` decision and removed Compose's silent false fallback. A false selection remains permitted for compatibility; production still requires the operator to make that choice explicitly.
3. Added migration 113 to remove recursive technician/supervisor RLS evaluation through a narrowly scoped, non-login policy-reader helper.
4. Added migration 114 to remove a recursive same-table ticket UPDATE policy subquery. The existing database lifecycle trigger remains the authority preventing direct status changes; lifecycle transitions continue through the constrained database function.
5. Changed the ticket API to return an explicit authentication response when verified-principal context is missing.
6. Hardened the field web app: masked bearer-token input, validated the API destination before reading/sending the token, restricted cross-origin API use to exact HTTPS allowlist entries, rejected redirects/cookies, and moved the OCR library, worker, four CPU/SIMD core variants, and English model to same-origin assets. Added upstream package provenance and SHA-256 pins for all 16 vendored files, plus CSP/HSTS/static-host and Nginx header configurations.
7. Replaced the implication that 114 catalogs are production-quality translations with a quality-labelled selector. Only 84 verified or machine-draft catalogs are selectable; machine drafts are labelled unreviewed, and untranslated placeholders are withheld. The quality gate still reports 17 locales without native Node `Intl` formatting data; browser fallback is surfaced rather than represented as native locale formatting.
8. Updated migration counts, immutable checksums, RLS inventory, commercial migration range, release manifest, and release gates to reflect migrations 113-114 and the extracted field-web client.
9. Removed `@opentelemetry/auto-instrumentations-node`, which enabled 39 unrelated integrations when telemetry was turned on. OpenTelemetry remains opt-in and now instruments only HTTP and PostgreSQL; supply-chain tests prevent the broad bundle and unrelated plugins from returning unnoticed.
10. Production readiness now requires a Redis HA proof file whenever the Redis backend is selected. It must attest managed HA, automatic failover, and a failover test performed within 180 days; a successful Redis PING alone is insufficient. The gate validates the buyer-owned attestation and its date; it does not independently inspect the provider control plane or execute failover.

## Remaining limitations — not represented as fixed

- No real production identity provider was connected. OIDC/JWKS was not smoke-tested against the buyer's IdP or production signing-key rotation.
- No buyer KMS/HSM/secret-manager, object-storage, NMS/OTDR, webhook/messaging, backup/restore, production TLS ingress, health-alerting, or production topology was available for end-to-end proof. The production-readiness gate still requires environment-specific evidence for these boundaries.
- The Redis integration proves shared rate limiting locally, not managed-service HA or failover. Redis is a critical request-path dependency: if unavailable, rate-limited API/AI traffic—including `/health` because it passes through the edge limiter—returns 503 by design. No customer Redis HA/failover test was available; do not deploy Redis mode without the required recent proof and failover/alert plan. The readiness check validates an operator attestation, not the provider's control plane.
- The kernel nonce/replay store remains process-local; production readiness rejects multiple instances when the HMAC boundary is enabled. Do not claim horizontally shared replay protection.
- `FIBEROS_KERNEL_BOUNDARY_REQUIRED` is now explicit rather than silently omitted, but an explicit `false` remains possible and HMAC mode is not forced on for OIDC/browser clients.
- Camera, GPS, OCR accuracy, CSP/HSTS headers, and cross-origin deployment behavior were not exercised on a buyer device or against the buyer's hosting/ingress; the code, local assets, regression tests, and deployment header configurations were checked.
- Historical audit snapshots retain the counts and evidence that were true when those snapshots were written. The verification record above is the current closeout baseline for this package.
- Native JWT/CIDR/HTTP security code was not replaced wholesale: the supplied checklist identified a maintainability concern but no concrete defect in those implementations, and the current security/test gates passed. Continue independent security review before a high-risk production rollout.

**Conclusion:** The identified code-level failures that could be reproduced locally were corrected and the current suite passes. External-provider proof, production configuration, and the remaining single-process replay boundary are disclosed constraints; FiberOS should not be described as fully production-verified until the buyer's readiness evidence is supplied and accepted.
