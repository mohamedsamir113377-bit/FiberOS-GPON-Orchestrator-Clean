# FiberNexus-1 / Neon production attestation — 2026-10-13

**Evidence class:** Read-only point-in-time engineering evidence. This is not buyer go-live acceptance or a claim that every production integration has passed.

## Exact source and deployment observations

- GitHub `main` source baseline observed: `18c3252fc62ca00e4ade825a1b273c1404492dcb`.
- Repository: `codespine78-web/FiberNexus-1`.
- Vercel project: `fibernexus-1` (`prj_5sVUbiAa3djSYWLBK3mCzI5PpmSp`).
- Vercel production deployment: `dpl_5HVxW1baqZsJvGw18ewyxaTzHTK2`, state `READY`, Git metadata reports branch `main` and the same source SHA shown above.
- GitHub commit status for that SHA reports the Vercel context as `success`.
- The following Actions runs completed with `conclusion=success` and each reported the exact SHA above:
  - `database-migrations`: [38401501772](https://github.com/codespine78-web/FiberNexus-1/actions/runs/38401501772)
  - `release-admission`: [38401501758](https://github.com/codespine78-web/FiberNexus-1/actions/runs/38401501758)
  - `website-build`: [38401501432](https://github.com/codespine78-web/FiberNexus-1/actions/runs/38401501432)
  - `visual-regression`: [38401501337](https://github.com/codespine78-web/FiberNexus-1/actions/runs/38401501337)

## Neon migration and tenant-isolation checks

- Neon project: `FiberOS` (`fragrant-voice-83289037`).
- Target branch: `production` (`br-tiny-cherry-b4x1vpkw`), reported as primary/default and `ready`.
- Database version: PostgreSQL `18.6`.
- Read-only query of `public.fiberos_migration_history` returned 186 rows, from `001_extensions.sql` through `186_migration_history_attestation.sql`.
- Every row SHA-256 was compared with the corresponding `SALES_PACKAGE_MANIFEST.json` value at the source baseline using `sql/migrations/<migration_name>`: **186 checked, 0 missing manifest entries, 0 mismatches**.
- The latest two observed rows were:
  - `185_enforce_area_supervisor_resource_scope.sql` — `2026-10-13T14:27:36.329Z`
  - `186_migration_history_attestation.sql` — `2026-10-13T14:27:36.459Z`
- The canonical RLS inventory at the observed source baseline declares 184 tenant-sensitive tables. A read-only comparison against production found **184/184 present, RLS enabled, FORCE RLS enabled; 0 failures**.
- Two public tables did not have RLS enabled: `fiberos_migration_history` (protected by explicit table ACLs in the observed source design) and `spatial_ref_sys` (spatial reference metadata). They were not counted as tenant-sensitive inventory entries.

## Security items that remain open

- Project settings reported `block_public_connections=false`, `allowed_ips.ips=[]`, and `protected_branches_only=false`. Therefore this evidence does **not** establish restrictive Neon network allow-listing or blocked public connectivity. Do not enable blocking until actual application egress, access paths, and recovery access are established and tested.
- The role inventory reported `fiberos_policy_reader` with `rolbypassrls=true` and `rolcanlogin=false`. It is used as owner of scoped `SECURITY DEFINER` functions and has limited direct table grants in the observed catalog; this is a high-trust boundary that still needs an explicit least-privilege review of function bodies, ownership, grants, and membership. No role change was made.
- GitHub reported `protected=false` for `main` and two non-main branches. The current connector could not read branch-protection settings because its GitHub App integration returned HTTP 403.
- A Vercel runtime-log query for the deployment failed with HTTP 403. This is an access failure, **not** proof that runtime logs are empty or error-free.
- No production SQL, Neon project settings, Vercel configuration, or credentials were changed during these read-only checks. Tokens pasted into the conversation must be revoked/rotated separately.

## Final evidence boundary

These observations are tied to the source baseline recorded above. Re-run the migration checksum comparison and hosted CI checks against the final merged `main` SHA before release. The evidence does not by itself certify live API endpoints, OIDC/JWKS, Redis HA, object storage, KMS/HSM, edge firewall behavior, recovery drills, or buyer acceptance.


## Final closeout addendum — 2026-10-13T16:33Z

**Evidence boundary:** this is the verified post-merge closeout snapshot. It supplements, but does not rewrite, the earlier 18c3252 / migration-186 read-only snapshot above. It is not buyer go-live acceptance or a claim that every external integration passed.

### Exact source, CI, and Vercel

- GitHub repository: `codespine78-web/FiberNexus-1`.
- Main merge commit at this snapshot: `5d06e1c9c1c32a5c7a4117770c65344525d0e122` (PR #44; squash merge).
- All 12 recorded GitHub checks on that exact SHA completed successfully. The release-admission, database-migrations, website-build, and visual-regression runs were respectively [38431461426](https://github.com/codespine78-web/FiberNexus-1/actions/runs/38431461426), [38431461371](https://github.com/codespine78-web/FiberNexus-1/actions/runs/38431461371), [38431461330](https://github.com/codespine78-web/FiberNexus-1/actions/runs/38431461330), and [38431461292](https://github.com/codespine78-web/FiberNexus-1/actions/runs/38431461292); each reports that same SHA and `success`.
- Vercel production deployment `dpl_EkP83oNCFEfq4ngjwZak3w1yUKEi` (`https://fibernexus-1-lmuc4wuff-fiber-os1.vercel.app`) is `READY`; Vercel metadata reports `main` and that exact SHA.
- A live Vercel runtime-error aggregation request returned HTTP 403 from the connected integration. Runtime errors/logs therefore could not be independently inspected; no claim that production has zero runtime errors is made.

### Neon production after migration 187

- Neon project `fragrant-voice-83289037`, branch `br-tiny-cherry-b4x1vpkw` (`production`), database `neondb`, PostgreSQL `18.6`.
- `public.fiberos_migration_history` returned 187 rows, latest `187_pin_security_definer_search_path.sql`, zero malformed SHA-256 values, exactly one row for migration 187, and row hash `9c07a7275fadae339703f323ae47d1e2732bd16d425c6da636a4161dbafa68a7` matching `SALES_PACKAGE_MANIFEST.json`.
- All six protected functions remain `SECURITY DEFINER`, owned by `fiberos_owner`, pinned to `search_path=pg_catalog, public, pg_temp`, and attached to enabled triggers.
- A transaction-scoped temp-name shadowing smoke test confirmed a temporary `network_assets` did not take precedence over `public.network_assets` under the pinned path; the temporary table was discarded. This is not a full adversarial invocation test for every function.

### Release blockers and explicit caveats

- A read-only row-count check returned zero rows in these eight core tables at the check time: `tenants`, `network_assets`, `technicians`, `tickets`, `technician_positions`, `splice_records`, `technician_role_assignments`, and `ticket_worker_assignments`. No synthetic operational data was added to production; populated-tenant end-to-end acceptance remains unproven.
- Neon project settings remained `block_public_connections=false` and the allowed-IP list empty. No network setting was changed because real application egress and recovery access still need a controlled plan.
- The high-trust non-login role `fiberos_policy_reader` still has `rolbypassrls=true`; its function ownership, grants, and memberships need a focused least-privilege review. No role or branch-protection setting was changed in this closeout.
- The current capability registry declares 106 capabilities: 44 `REAL`, 11 `UNIMPLEMENTED`, 24 `VISION`, 23 `ADVISORY`, and 4 `INTEGRATION_REQUIRED`. The buyer-data catalogue reports 114 locale files but only 1 verified locale and 113 structural placeholders. Full feature and translation acceptance is not complete.
- The admitted source ZIP passed manifest parity in CI, but a public commercial release asset plus matching external SHA-256 sidecar and buyer-signed runtime/go-live acceptance have not been published/received. Overall commercial release status therefore remains **HOLD**.


## Final exact-main documentation audit — 2026-10-13T16:46Z

This snapshot supersedes the earlier 16:33Z closeout addendum for the *current repository/deployment identity*. The prior addendum remains an immutable point-in-time record of the code-bearing PR #44 merge before documentation/provenance-only PR #45.

### Exact current source and checks

- Repository: `codespine78-web/FiberNexus-1`.
- Current `main`: `a6c55b5638e3f11f5b8043ec727b27797f7eae57` (PR #45 merge; docs/evidence/provenance update only, no SQL migration changed).
- Source verification for this exact SHA reported **884 tests, 884 passed, 0 failed**. The same CI run reported migration-sequence integrity, capability parity, domain-neutrality, manifest parity, release-provenance check, JavaScript syntax verification, verified-source-ZIP parity, and upload of the ZIP artifact as passing.
- Exact-main `release-admission`: [run 38432964015](https://github.com/codespine78-web/FiberNexus-1/actions/runs/38432964015) — success. Runtime security gates for API, AI, GIS and worker, source hygiene, and hosted PostgreSQL/PostGIS RLS all completed successfully on the same SHA.
- Exact-main website build/performance: [run 38432964476](https://github.com/codespine78-web/FiberNexus-1/actions/runs/38432964476) — success; Lighthouse artifacts uploaded.
- Exact-main visual regression: [run 38432964057](https://github.com/codespine78-web/FiberNexus-1/actions/runs/38432964057) — success; 16 captures with no drift beyond tolerance.
- Code-bearing migration workflow [38431461371](https://github.com/codespine78-web/FiberNexus-1/actions/runs/38431461371) passed on SHA `5d06e1c9c1c32a5c7a4117770c65344525d0e122`, which introduced migration 187. PR #45 did not alter migration files. The final main SHA then passed its hosted PostgreSQL/PostGIS RLS and release-admission gates.

### Final Vercel production deployment

- Deployment: `dpl_8mJcXNS9SAH5am5wAz3CVWqqYndt`.
- URL: https://fibernexus-1-kec38fuhi-fiber-os1.vercel.app.
- State: `READY`; target `production`; Git ref `main`; deployed SHA `a6c55b5638e3f11f5b8043ec727b27797f7eae57` — exact match.
- Runtime error aggregation remained inaccessible through the connected Vercel integration (HTTP 403). No claim is made that production has zero runtime errors.

### Neon production ledger and search-path evidence

- Project `fragrant-voice-83289037`, production branch `br-tiny-cherry-b4x1vpkw`, database `neondb`, PostgreSQL `18.6`.
- Fresh ledger query after the code merge returned **187 rows**, latest `187_pin_security_definer_search_path.sql`, **0 malformed SHA-256 values**, exactly **1** row for migration 187. Its recorded digest `9c07a7275fadae339703f323ae47d1e2732bd16d425c6da636a4161dbafa68a7` matches the migration digest in `SALES_PACKAGE_MANIFEST.json`.
- Six SECURITY DEFINER trigger functions were re-queried individually after migration 187; all six remain owned by `fiberos_owner`, have `search_path=pg_catalog, public, pg_temp`, and have an enabled trigger binding. This does not replace populated-tenant adversarial trigger invocation tests.

### Remaining truth boundaries

- The eight core production tables checked for representative end-to-end acceptance contained zero rows at the check time. No synthetic test data was added to production; tenant A/B and field-scope end-to-end acceptance with populated records remains open.
- Neon settings remained `block_public_connections=false` with an empty allowed-IP list. No network lock-down was attempted without a tested egress/recovery plan.
- `fiberos_policy_reader` remains a high-trust non-login role with `rolbypassrls=true`; the dedicated least-privilege ownership/grant/membership review remains open.
- The 106-capability catalogue is not uniformly production-ready (11 unimplemented, 24 vision, 23 advisory, 4 integration-required). The locale catalogue has 114 files but only 1 verified locale and 113 structural placeholders.
- The source ZIP passed exact-main manifest/content-hash parity but has not yet been published with an external SHA-256 sidecar. Signed buyer runtime attestation and authorized Go-Live decision remain absent.

**Decision: source/CI/Neon migration/production deployment closeout verified for the exact source snapshot. Commercial delivery and buyer Go-Live remain HOLD until the remaining truth boundaries above are closed.**
