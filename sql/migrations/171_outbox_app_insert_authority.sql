-- 171_outbox_app_insert_authority.sql
-- Close fieldClose runtime admission gap: trusted fiberos_app must be able to
-- INSERT (and SELECT for ON CONFLICT arbiter visibility) tenant-scoped outbox
-- rows under FORCE RLS after migration 107 revoked authenticated DML.
BEGIN;

DROP POLICY IF EXISTS outbox_insert_tenant_app ON outbox_events;
DROP POLICY IF EXISTS outbox_insert_tenant_r8 ON outbox_events;
DROP POLICY IF EXISTS outbox_insert_fiberos_app ON outbox_events;
DROP POLICY IF EXISTS outbox_insert_authenticated_tenant ON outbox_events;
DROP POLICY IF EXISTS outbox_select_fiberos_app ON outbox_events;

-- ON CONFLICT DO NOTHING requires the arbiter rows to be visible under SELECT RLS.
CREATE POLICY outbox_select_fiberos_app ON outbox_events
  FOR SELECT TO fiberos_app
  USING (tenant_id = public.fiberos_current_tenant_id());

-- Authoritative API writer path (session role after SET LOCAL ROLE fiberos_app).
CREATE POLICY outbox_insert_fiberos_app ON outbox_events
  FOR INSERT TO fiberos_app
  WITH CHECK (tenant_id = public.fiberos_current_tenant_id());

-- Narrow residual path for sessions that remain as authenticated only.
CREATE POLICY outbox_insert_authenticated_tenant ON outbox_events
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.fiberos_current_tenant_id()
    AND public.fiberos_has_any_role(ARRAY[
      'field_tech','qc','ops_manager','dispatcher','area_supervisor','sysadmin','call_center'
    ])
  );

COMMIT;
