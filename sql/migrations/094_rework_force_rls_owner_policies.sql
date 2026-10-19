-- 094_rework_force_rls_owner_policies.sql
-- FiberOS R14.1 — restore SECURITY DEFINER rework authority under FORCE RLS.
--
-- Migration 058 intentionally makes rework_cases and rework_case_events
-- FORCE RLS and revokes direct DML from application roles. The SECURITY
-- DEFINER rework authority functions execute as fiberos_owner, so they need
-- explicit owner policies that remain tenant-scoped and actor-bound.
--
-- This migration does not weaken FORCE RLS and does not grant direct DML to
-- authenticated/fiberos_app.

BEGIN;

ALTER TABLE rework_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE rework_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE rework_case_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rework_case_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rework_cases_owner_select ON rework_cases;
CREATE POLICY rework_cases_owner_select ON rework_cases
FOR SELECT TO fiberos_owner
USING (tenant_id = fiberos_session_tenant_id());

DROP POLICY IF EXISTS rework_cases_owner_insert ON rework_cases;
CREATE POLICY rework_cases_owner_insert ON rework_cases
FOR INSERT TO fiberos_owner
WITH CHECK (
  tenant_id = fiberos_session_tenant_id()
  AND reported_by = auth.uid()
);

DROP POLICY IF EXISTS rework_cases_owner_update ON rework_cases;
CREATE POLICY rework_cases_owner_update ON rework_cases
FOR UPDATE TO fiberos_owner
USING (tenant_id = fiberos_session_tenant_id())
WITH CHECK (
  tenant_id = fiberos_session_tenant_id()
);

DROP POLICY IF EXISTS rework_case_events_owner_select ON rework_case_events;
CREATE POLICY rework_case_events_owner_select ON rework_case_events
FOR SELECT TO fiberos_owner
USING (tenant_id = fiberos_session_tenant_id());

DROP POLICY IF EXISTS rework_case_events_owner_insert ON rework_case_events;
CREATE POLICY rework_case_events_owner_insert ON rework_case_events
FOR INSERT TO fiberos_owner
WITH CHECK (
  tenant_id = fiberos_session_tenant_id()
  AND actor_id = auth.uid()
);

COMMIT;
