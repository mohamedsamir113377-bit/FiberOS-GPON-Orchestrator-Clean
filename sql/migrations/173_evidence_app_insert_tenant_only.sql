-- 173_evidence_app_insert_tenant_only.sql
-- Application path already enforces technician scope via permissionContext.
-- Under FORCE RLS the trusted fiberos_app role must be able to persist evidence
-- rows for the current tenant without requiring a second nested RLS visibility
-- check on tickets that can fail closed during policy evaluation.
BEGIN;

DROP POLICY IF EXISTS evidence_insert_fiberos_app ON evidence;
CREATE POLICY evidence_insert_fiberos_app ON evidence
  FOR INSERT TO fiberos_app
  WITH CHECK (tenant_id = public.fiberos_current_tenant_id());

COMMIT;
