-- 172_field_evidence_app_insert_authority.sql
-- Mirror migration 171 for evidence / optical_measurements / field_close_idempotency:
-- after REVOKE INSERT FROM authenticated, trusted fiberos_app needs explicit
-- FORCE-RLS policies so field evidence submit and fieldClose chains persist.
BEGIN;

-- evidence
DROP POLICY IF EXISTS evidence_insert_fiberos_app ON evidence;
DROP POLICY IF EXISTS evidence_select_fiberos_app ON evidence;
CREATE POLICY evidence_select_fiberos_app ON evidence
  FOR SELECT TO fiberos_app
  USING (tenant_id = public.fiberos_current_tenant_id());
CREATE POLICY evidence_insert_fiberos_app ON evidence
  FOR INSERT TO fiberos_app
  WITH CHECK (
    tenant_id = public.fiberos_current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.tickets tk
      WHERE tk.id = evidence.ticket_id
        AND tk.tenant_id = evidence.tenant_id
        AND (
          public.fiberos_ticket_is_owned(tk.technician_id)
          OR public.fiberos_has_any_role(ARRAY['qc','ops_manager','area_supervisor','sysadmin'])
        )
    )
  );

-- optical_measurements (fieldClose path)
DROP POLICY IF EXISTS optical_measurements_insert_fiberos_app ON optical_measurements;
CREATE POLICY optical_measurements_insert_fiberos_app ON optical_measurements
  FOR INSERT TO fiberos_app
  WITH CHECK (tenant_id = public.fiberos_current_tenant_id());

-- field_close_idempotency
DROP POLICY IF EXISTS field_close_idempotency_insert_fiberos_app ON field_close_idempotency;
DROP POLICY IF EXISTS field_close_idempotency_select_fiberos_app ON field_close_idempotency;
CREATE POLICY field_close_idempotency_select_fiberos_app ON field_close_idempotency
  FOR SELECT TO fiberos_app
  USING (tenant_id = public.fiberos_current_tenant_id());
CREATE POLICY field_close_idempotency_insert_fiberos_app ON field_close_idempotency
  FOR INSERT TO fiberos_app
  WITH CHECK (tenant_id = public.fiberos_current_tenant_id());

COMMIT;
