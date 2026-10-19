-- FiberOS R8: close legacy permissive policies that survived later tenant hardening.
-- Fail-closed. This migration does not guess tenant ownership and does not grant
-- new cross-tenant capabilities.

-- Legacy audit insert policy is obsolete: authoritative writes use the append
-- SECURITY DEFINER function and direct INSERT is already revoked.
DROP POLICY IF EXISTS audit_insert_authenticated ON audit_log;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

-- Legacy optical policies from migration 014 were never dropped by the later
-- tenant-authority migration. Because PostgreSQL combines permissive policies
-- with OR semantics, leaving them active could bypass tenant isolation.
DROP POLICY IF EXISTS optical_measurements_insert_field ON optical_measurements;
DROP POLICY IF EXISTS optical_measurements_select_field ON optical_measurements;

CREATE POLICY optical_measurements_tenant_select_r8 ON optical_measurements
FOR SELECT TO authenticated
USING (
  tenant_id = fiberos_current_tenant_id()
  AND fiberos_has_any_role(ARRAY['field_tech','qc','ops_manager','dispatcher','area_supervisor','sysadmin','exec'])
);

CREATE POLICY optical_measurements_tenant_insert_r8 ON optical_measurements
FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = fiberos_current_tenant_id()
  AND (
    fiberos_ticket_is_owned(measured_by)
    OR fiberos_has_any_role(ARRAY['qc','ops_manager','area_supervisor','sysadmin'])
  )
);

-- Legacy outbox policies from migration 014 were role-only / open. Outbox rows
-- are tenant-scoped since migration 023. Keep authenticated insertion available
-- only when the row belongs to the caller's tenant; the runtime service role may
-- use its separate database privilege path.
DROP POLICY IF EXISTS outbox_insert_app ON outbox_events;
DROP POLICY IF EXISTS outbox_select_app ON outbox_events;

CREATE POLICY outbox_insert_tenant_r8 ON outbox_events
FOR INSERT TO authenticated, fiberos_app
WITH CHECK (tenant_id = fiberos_current_tenant_id());

CREATE POLICY outbox_select_tenant_r8 ON outbox_events
FOR SELECT TO authenticated
USING (
  tenant_id = fiberos_current_tenant_id()
  AND fiberos_has_any_role(ARRAY['ops_manager','sysadmin','dispatcher','qc','exec'])
);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_timestamp_r8
  ON audit_log(tenant_id, "timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_optical_measurements_tenant_measured_at_r8
  ON optical_measurements(tenant_id, measured_at DESC);
