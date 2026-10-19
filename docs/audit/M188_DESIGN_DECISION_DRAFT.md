# Migration 188 — design decision draft (pre-implementation)

**Status:** DRAFT for human approval — no production SQL authorized.  
**Date:** 2026-10-16  
**Branch:** audit/pre-ci-static-clean-2026-10-16

## Decision needed

Replace ECL RLS reliance on client-influenced `app.tenant_id` GUC with the same **trusted tenant resolver** used elsewhere (`fiberos_current_tenant_id()` / membership), and align hash+verify per-tenant including `actor`.

## Recommended direction (pending sign-off)

| Topic | Recommendation |
|-------|----------------|
| Read/write RLS on `enterprise_change_log` | `tenant_id = fiberos_current_tenant_id()::text` (or explicit text cast contract) under FORCE RLS |
| API session | After `applyPrincipal`, bind tenant from membership server-side; do not trust request body for tenant |
| Worker | Bind from job row `tenant_id` inside constrained/definer path |
| Hash v1 | Include actor; UTC canonical timestamp; per-tenant prev |
| Verify | Per-tenant walk, not global seq prev |
| Triggers | Only after non-prod E1–E6 pass; allowlisted tables only |
| Ship vehicle | New migration ≥190 forward-only |

## Explicit rejects

- Using `current_setting('app.tenant_id')` alone as authorization boundary  
- Rewriting applied 188 checksum history on production  
- Attaching capture triggers before non-prod proof

## Test gate before coding migration

`sql/tests/m188_e1_e6_nonprod_tests.sql` on disposable PG18 + extended cases for membership spoof.
