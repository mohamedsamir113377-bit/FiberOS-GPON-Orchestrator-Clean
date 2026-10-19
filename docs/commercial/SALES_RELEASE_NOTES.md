# Sales Release Notes — Commercial Release Candidate

## Release identity

- Product: `FiberOS R14.1 Sales Core`
- Version: `1.0.0-rc.1+commercial.2026-09-25`
- Current candidate migration chain: `001–196`
- Reference list price: **USD 3,500**
- Current online campaign price: **USD 3,000** (USD 500 discount)
- Standard support proposal: **14 calendar days**

## What is materially closed in this release

- Fail-closed production hold with live-evidence freshness and deployment-binding controls.
- Canonical HTTP application-role admission middleware.
- Database-authoritative ticket and incident lifecycle controls.
- Tenant-bearing foreign-key and warehouse cross-tenant integrity closures.
- Additive incident owner/trusted-admin path closure in migration 110/111.
- The current `001–196` source tree passes the source integrity, migration-sequence, manifest, and provenance gates. On main SHA `811b25695c4eb427462d15481537baa62f679874` (2026-10-17), hosted release-admission passed, including ephemeral PostgreSQL/PostGIS RLS and adversarial tenant/FK checks. This is seller-side CI evidence only; buyer-owned production runtime and go-live acceptance remain separate release gates.
- Buyer documentation, reseller/white-label rights, support scope, security boundary, and dependency disclosure reconciled to the current source tree.
- Commercial release contract added as a single source of truth for reference pricing, support, runtime baseline, and migration range.

## Seller/reference verification record — 2026-09-25

The supplied external evidence records live/reference-environment checks for Node 24.21.0, PostgreSQL 18.6/PostGIS 3.6.4, OIDC/JWKS RS256, TLS 1.3, npm audit, and OSV-Scanner. The evidence archive contains earlier pre-fix records alongside later post-fix results; the later results correspond to the migration-111 source state. Treat the evidence as an engineering audit trail, not a universal customer-production certificate.

## Customer production boundary

The buyer must verify its own PostgreSQL/RLS, identity provider, TLS/ingress, secrets, backup/restore, rate-limit architecture, external adapters, and production attestation before go-live.

## Commercial/legal boundary

The archive is distributed under the online commercial licensing model. Standard purchase grants the rights stated in ONLINE_COMMERCIAL_LICENSE.md; source redistribution, master-reseller rights, IP assignment, and exclusivity require an explicitly selected tier or separate valid agreement.

## Field operations intelligence extension — 2026-10-03

At the time of the 2026-10-03 extension, the buyer archive's database chain extended through migration **120**.
The 2026-10-03 extension adds four deterministic source-backed operational surfaces: alarm/topology correlation, optical health timeline, evidence-chain hashing/certification, and port-capacity intelligence. These are documented as advisory or database-backed capabilities and do not imply live provider connectivity, prediction, or autonomous action.


## 2026-10-07 source closure addendum

The handoff now includes deterministic end-to-end trace resolution, planned/field/as-built GIS reconciliation, explicit call/incident correlation, a generic offline operation envelope, optical evidence provenance validation, and explicit interrupted-control reauthorization. These are source/test boundaries only; vendor, device, database runtime and buyer-environment proof remain separate.
