-- 083_rls_gap_hash_ledger_org_units_fix.sql
-- Fixes a real gap found during manual audit (2026-09-11): two tables had
-- no ROW LEVEL SECURITY enabled at all.
--
--  * hash_ledger: policies hash_ledger_insert_auth / hash_ledger_select_ops
--    already existed (migration 016) but were dormant because RLS was
--    never turned on for the table. This migration only enables RLS;
--    it does not change the policies themselves.
--
--  * org_units: had no RLS and no policy of any kind. Default Postgres/
--    Supabase grants on public tables mean authenticated (and possibly
--    anon) could read the full cross-tenant org hierarchy. This adds a
--    tenant-scoped SELECT policy using the same fiberos_current_tenant_id()
--    helper already used elsewhere (see 023_p0_tenant_authority.sql).
--    org_tenant_id is nullable in the base table (013_org_units_optional.sql),
--    so rows with a NULL tenant are treated as shared/global and remain
--    visible to any authenticated user — adjust this if that is not the
--    intended semantics for your deployment.
--    No INSERT/UPDATE/DELETE policy is added: writes stay default-denied
--    under RLS unless you add one or write through a SECURITY DEFINER
--    function, matching the "safe additive" intent in the original
--    migration comment.

ALTER TABLE hash_ledger ENABLE ROW LEVEL SECURITY;

ALTER TABLE org_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_units_select_tenant ON org_units;
CREATE POLICY org_units_select_tenant ON org_units
  FOR SELECT TO authenticated
  USING (org_tenant_id = fiberos_current_tenant_id()::text OR org_tenant_id IS NULL);
