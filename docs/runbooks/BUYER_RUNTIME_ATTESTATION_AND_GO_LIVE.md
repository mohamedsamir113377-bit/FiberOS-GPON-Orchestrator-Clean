# Buyer runtime attestation and Go-Live acceptance

## Purpose and evidence boundary

This process binds acceptance to one buyer organization, one production deployment, and one exact release. It has three stages: a signed live runtime attestation; a separate signed decision by an authorized buyer approver; and independent verification of both signatures, key IDs, buyer/deployment/release identity, freshness, every readiness result, and the digest binding between records.

No command here clears Production Hold or changes deployment configuration. That remains a separately authorized operations decision.

## Trusted issuer for operational control proofs

The readiness gate probes live PostgreSQL/PostGIS and runtime role boundaries, OIDC/JWKS, TLS ingress, Redis/replay defense where required, and configured checks. Health/alert, backup/restore, and external-adapter evidence must additionally be signed by a buyer-approved issuer. Unsigned JSON booleans are rejected.

Protected buyer variables:
- FIBEROS_BUYER_ORGANIZATION_ID: stable buyer organization identifier.
- FIBEROS_DEPLOYMENT_ID: identifier for the exact production deployment.
- FIBEROS_RUNTIME_CONTROL_PROOF_PUBLIC_KEY_FILE: trusted public key of the approved issuer.
- FIBEROS_RUNTIME_CONTROL_PROOF_KEY_ID: issuer key ID pinned by the buyer.
- FIBEROS_HEALTH_PROOF_FILE: signed healthMetricsAlerts proof.
- FIBEROS_BACKUP_RESTORE_PROOF_FILE: signed backupRestore proof.
- FIBEROS_EXTERNAL_ADAPTERS_PROOF_FILE: signed externalAdapters proof.

Envelope schema: fiberos.r14.1.buyer-runtime-control-proof.v1. Payload schema: fiberos.r14.1.buyer-runtime-control-proof-payload.v1. Ed25519 signs the canonical JSON payload. The payload binds proof type, result PASS, checkedAt, production environment, buyer ID, deployment ID, exact release identity, required checks, evidenceSha256, evidenceReferences, and producer ID. The release is packageVersion, manifestSha256, and sourceCommit. A ZIP without Git metadata must use sourceCommit null.

| Proof type | Required true checks |
|---|---|
| healthMetricsAlerts | healthy, alertsConfigured |
| backupRestore | backupCreated, restoreVerified, integrityVerified |
| externalAdapters | oidcJwks, objectStorage, kmsOrSecretManager, nmsOtdr, webhooks, messaging |

The runtime-attestation signer and Go-Live approver must use independently controlled Ed25519 key pairs. Their key IDs and public-key fingerprints must differ; the verifier rejects reused key material even if the IDs differ. Pin both public keys and IDs in the buyer trust store.

The signed runtime record must include every canonical readiness check exactly once: `node`, `npm`, `database`, `secretsBoundary`, `tlsIngress`, `rlsTenantIsolation`, `rateLimitBoundary`, `replayDefense`, `kernelBoundaryMode`, `identityOidcJwks`, `i18nProductionLocales`, `healthMetricsAlerts`, `backupRestore`, and `externalAdapters`. If `rateLimitBoundary.backend` is `REDIS`, `redisHighAvailability` is mandatory too. The verifier rejects a missing check, duplicate check name, unknown rate-limit backend, or absent trusted key ID.

The trusted signer must verify referenced operational evidence before issuing a signed statement. Never create proof files by hand, assert booleans without an actual operational test, put private keys into source, or store signing keys in Git. Proofs older than 24 hours or more than five minutes in the future are rejected.

## 1. Prepare the buyer runtime

Use the exact delivered release tree and set NODE_ENV=production. Supply live PostgreSQL/PostGIS, OIDC/JWKS, TLS, tenant/RLS isolation, Redis/replay defense where required, health/alerts, backup/restore, and adapter checks using the buyer's secret manager. Never commit runtime secrets.

## 2. Create a signed live runtime attestation

Mount the buyer-owned Ed25519 private key from an approved secret store. Set:
- FIBEROS_BUYER_RUNTIME_SIGNING_KEY_FILE
- FIBEROS_BUYER_RUNTIME_KEY_ID
- FIBEROS_RUNTIME_ATTESTATION_OUTPUT

Run:
~~~sh
export NODE_ENV=production
node scripts/buyer-acceptance/runtime-go-live-attestation.js runtime
~~~

The command checks scripts/release-provenance.js --check and then runs scripts/production-readiness-gate.js against the configured live environment. It emits RUNTIME_PRODUCTION only if every readiness check passes. The record binds package version, manifest SHA-256, Git HEAD when present, buyer/deployment identity, all check statuses, and a digest of the readiness report. It expires after 24 hours. Any missing or failing prerequisite returns BLOCKED and cannot create a passing attestation.

Output must be outside the packaged tree or inside excluded evidence/. Creation is exclusive; existing evidence is never overwritten.

## 3. Record explicit buyer acceptance

A separately authorized approver reviews the fresh runtime record. Set:
- FIBEROS_RUNTIME_ATTESTATION_FILE
- FIBEROS_BUYER_RUNTIME_PUBLIC_KEY_FILE
- FIBEROS_BUYER_RUNTIME_KEY_ID
- FIBEROS_GO_LIVE_DECISION=ACCEPT
- FIBEROS_GO_LIVE_ACCEPTED_BY
- FIBEROS_GO_LIVE_CHANGE_REFERENCE
- FIBEROS_GO_LIVE_OPEN_CRITICAL_EXCEPTIONS=0
- FIBEROS_GO_LIVE_ACCEPTANCE_SIGNING_KEY_FILE
- FIBEROS_GO_LIVE_ACCEPTANCE_KEY_ID
- FIBEROS_GO_LIVE_ACCEPTANCE_OUTPUT

After explicit approval:
~~~sh
node scripts/buyer-acceptance/runtime-go-live-attestation.js accept --confirm-go-live
~~~

Acceptance rechecks manifest consistency and validates runtime signature, pinned key ID, freshness, release identity, buyer/deployment identity, and all readiness results. Missing approver/change reference, any decision other than ACCEPT, or nonzero critical exceptions are rejected. The signed decision binds the full runtime-record digest. productionHoldReleaseExecuted remains false: acceptance evidence does not itself authorize a Production Hold change.

## 4. Independently verify the bundle

Keep both trusted public keys and key IDs in the buyer trust store. Set:
- FIBEROS_GO_LIVE_ACCEPTANCE_FILE
- FIBEROS_BUYER_RUNTIME_PUBLIC_KEY_FILE
- FIBEROS_BUYER_RUNTIME_KEY_ID
- FIBEROS_GO_LIVE_ACCEPTANCE_PUBLIC_KEY_FILE
- FIBEROS_GO_LIVE_ACCEPTANCE_KEY_ID
- FIBEROS_BUYER_ORGANIZATION_ID
- FIBEROS_DEPLOYMENT_ID

Run:
~~~sh
node scripts/buyer-acceptance/runtime-go-live-attestation.js verify
~~~

Verification fails closed on bad signatures, wrong key IDs, identity or release mismatch, failed readiness, digest/timestamp errors, invalid decision, or critical exceptions. Retain the bundle, referenced operational evidence, change reference, approver identity, and key-trust/rotation records in the buyer audit store.

## Truthful status

Source code and CI tests can prove signature and rejection logic; they cannot create evidence from the seller's environment. Runtime proof is complete only after the command succeeds on the buyer's real deployed release. Acceptance is complete only after the authorized buyer signs and independent verification returns VERIFIED_GO_LIVE_ACCEPTANCE. Until then it is pending and Production Hold remains fail-closed.
