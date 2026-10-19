# FiberOS — Adversarial DB Boundary Audit Evidence — 2026-09-22

## Scope

This audit targets the database authorization boundary only. It covers the production migration chain, tenant-sensitive table inventory, PostgreSQL role topology, SECURITY DEFINER functions, tenant-bearing foreign-key relationships, cross-tenant mutation attempts, and hash-ledger concurrency.

No production-readiness or customer-infrastructure certification is implied.

## Source integrity

- Production migration manifest: 101 migrations.
- Production migration checksum manifest: 101 checksums.
- Runtime CI applies the checksum-verified production migration chain; the current hardening chain is 101 migrations.
- Static adversarial migration audit passed with checksums verified.
- PostGIS runtime image: `postgis/postgis:18-3.6`, identity pinned and verified by the existing CI gate.

## Runtime database evidence

Successful GitHub Actions run:

- Workflow: `runtime-postgres-rls`
- Run: `35779683109`
- Commit: `28ab1adac3ed2fc744e89b2b56496c24978e7708`
- Evidence class: `EPHEMERAL_CI_RUNTIME_ADVERSARIAL_DB_AUDIT`

Observed results:

- Tenant-sensitive inventory: 82 declared / 82 present in live schema.
- Weak tenant-sensitive tables: none.
- Worker privilege leaks outside `outbox_events`: none.
- Public schema CREATE privilege leaks among application identities: none.
- SECURITY DEFINER functions inspected: 23.
- All inspected application SECURITY DEFINER functions had an explicit function-level `search_path`, were owned by `fiberos_owner`, and had no PUBLIC EXECUTE grant according to the runtime catalog query.
- Tenant-bearing FK relationships requiring explicit review: 76 in the prior 99-migration runtime evidence. The exhaustive mutation gate then identified and closed one concrete gap on `evidence.ticket_id`; the 100-migration rerun must re-establish the final count.
- Cross-tenant mutation probes: 3/3 blocked.
- Hash-ledger stale-head concurrency: 1 success / 1 rejection.
- Existing live RLS/authority harness: success.

## Newly proven tenant-boundary finding

The exhaustive mutation gate on runtime run `35782669045` rejected the overall gate on constraint `evidence_ticket_id_fkey`: an `evidence.ticket_id` value could be changed from a Tenant-A ticket to a Tenant-B ticket without a tenant-consistency error. This was treated as a database-boundary defect, not as a fixture failure.

Migration `100_operational_tenant_fk_integrity_completion.sql` adds a SECURITY INVOKER trigger guard on `evidence` that checks `NEW.ticket_id` against `NEW.tenant_id` and raises `TENANT_MISMATCH_EVIDENCE_TICKET` on cross-tenant references. Migration 099 remains immutable.

The 100-migration chain, checksum registration, inventory count, and static migration gate were updated together. A fresh PostgreSQL/PostGIS runtime execution is required before this closure is counted as runtime evidence.

The next exhaustive FK runtime run on migration 100 then identified a second concrete gap at constraint `field_close_idempotency_ticket_id_fkey`: a field-close idempotency row could be reassigned from a Tenant-A ticket to a Tenant-B ticket without a tenant-consistency rejection.

Migration `101_field_close_idempotency_tenant_fk_integrity.sql` adds a SECURITY INVOKER trigger guard on `field_close_idempotency` that checks `NEW.ticket_id` against `NEW.tenant_id` and raises `TENANT_MISMATCH_FIELD_CLOSE_TICKET` on a cross-tenant reference.

## Interpretation

The runtime evidence supports the following concrete statements for the pinned CI PostgreSQL/PostGIS environment:

1. Tenant-sensitive tables are present, owner-bound to `fiberos_owner`, and FORCE RLS is enabled.
2. Application database role membership and CREATE-surface checks passed.
3. Application SECURITY DEFINER functions satisfy the audited ownership/search-path/PUBLIC-execute boundary at that prior runtime commit.
4. The previously exercised cross-tenant mutation probes were rejected; the newly added migration-100/101 closures require current-head runtime re-execution.
5. Hash-ledger concurrency rejects a stale concurrent append from the same initial head.

The 76 non-composite tenant-bearing foreign keys remain a documented review surface; the new exhaustive harness requires every single-column candidate to produce the specific `BLOCKED_TENANT_ENFORCEMENT` result before the gate can pass. They are intentionally not converted into a blanket defect because the current schema establishes tenant consistency through triggers, RLS, and explicit authority functions in multiple areas. Any future schema change touching those relationships should extend the adversarial mutation matrix before release. The current-head 101-migration runtime rerun remains the authoritative closure test for the new guards.

## Files added/changed by this audit branch

- `scripts/buyer-acceptance/adversarial-db-static-audit.js`
- `scripts/buyer-acceptance/adversarial-db-runtime-audit.js`
- `scripts/buyer-acceptance/adversarial-tenant-fk-mutation-audit.js`
- `sql/migrations/100_operational_tenant_fk_integrity_completion.sql`
- `sql/migrations/101_field_close_idempotency_tenant_fk_integrity.sql`
- `.github/workflows/runtime-postgres-rls.yml`

## Boundary

This evidence is CI-runtime evidence only. It does not verify a customer-managed PostgreSQL service, external IdP/JWKS provider, storage/KMS/HSM, reverse proxy/network segmentation, production secrets, physical instruments, or live customer deployment.

## Current-head execution status

The current hardening head is `649d5f074f747f686d58c3ff1ee386fc90266fb3`. The most recent `verify`, `release-security-gate`, and `runtime-postgres-rls` attempts were created for that head but terminated before executing workflow steps; no current-head runtime PASS is claimed. The exhaustive tenant-FK harness was also corrected on this branch so that missing `crypto`/fixture state and incorrect PASS counting cannot produce a false result. A current-head GitHub Actions execution with actual job steps is still required.
