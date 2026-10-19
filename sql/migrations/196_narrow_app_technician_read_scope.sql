-- Migration 196: repair the 195 technicians read-scope regression.
--
-- 195 added a tenant-only SELECT policy on public.technicians TO fiberos_app.
-- Because every authenticated HTTP session executes as fiberos_app
-- (packages/db/src/session.js) AND fiberos_app is a member of the
-- authenticated role (sql/bootstrap/01_production_auth_shim.sql), the
-- authenticated policies from migrations 184/185 were already governing these
-- sessions correctly. A permissive fiberos_app policy OR-widens that closure
-- and let field_tech enumerate same-tenant technicians and area_supervisor
-- escape its subordinate scope — both caught by the hosted RLS runtime gate:
--   "field_tech must not inherit the supervisor role or enumerate a
--    same-tenant subordinate"
--   "area_supervisor must not enumerate same-tenant technicians outside its
--    explicit scope"
--
-- Correct minimal repair: DROP the widening policy entirely, restoring the
-- proven green-run policy set (technicians_field_self_select +
-- technicians_select_tenant from migration 185, which scope field_tech to its
-- own row, area_supervisor/team_lead to their explicit subordinate scope, and
-- keep dispatcher/ops_manager/exec/sysadmin/qc at tenant-wide read for the
-- dispatch candidate engines). The explicit SELECT grant to fiberos_app from
-- 195 is kept so dispatch never fails on table privilege, independent of
-- authenticated-membership bootstrap state.
BEGIN;

DROP POLICY IF EXISTS technicians_app_tenant_read ON public.technicians;
GRANT SELECT ON public.technicians TO fiberos_app;

COMMIT;
