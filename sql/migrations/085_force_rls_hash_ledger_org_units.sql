-- 085_force_rls_hash_ledger_org_units.sql
-- Closes the last inconsistency from 083_rls_gap_hash_ledger_org_units_fix.sql:
-- every other table in this schema that has RLS enabled also has it FORCED
-- (see 051/052/055/056/058/059-065/072 for the pattern), but hash_ledger and
-- org_units were left ENABLE-only. FORCE matters only if a connection ever
-- runs as the table owner (fiberos_owner) rather than the constrained
-- fiberos_app/fiberos_runtime path the API uses (see
-- sql/bootstrap/00_production_roles.sql) — this closes that residual case
-- for ad hoc/maintenance connections rather than relying solely on the
-- runtime never using the owner role.
--
--  * hash_ledger: already has direct INSERT/UPDATE/DELETE revoked from
--    every non-owner role (025, 069) and a BEFORE UPDATE/DELETE trigger
--    that rejects mutation outright (012). FORCE closes the remaining gap,
--    which was read access via an owner-privileged connection.
--  * org_units: had only a single SELECT policy (083) with no other
--    defense layer. FORCE is the meaningful fix here.

ALTER TABLE hash_ledger FORCE ROW LEVEL SECURITY;
ALTER TABLE org_units FORCE ROW LEVEL SECURITY;
