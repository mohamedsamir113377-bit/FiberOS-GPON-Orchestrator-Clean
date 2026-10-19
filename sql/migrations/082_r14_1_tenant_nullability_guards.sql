-- R14.1 Alpha85 PRE-DB hardening: prevent new tenantless security/audit rows.
-- Historical rows may remain tenantless until an evidence-backed migration plan exists.
-- NOT VALID is intentional: it enforces every INSERT/UPDATE immediately while deferring
-- validation of pre-existing rows until their ownership can be proven safely.
BEGIN;

ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_tenant_id_required
  CHECK (tenant_id IS NOT NULL) NOT VALID;

ALTER TABLE security_events
  ADD CONSTRAINT security_events_tenant_id_required
  CHECK (tenant_id IS NOT NULL) NOT VALID;

COMMENT ON CONSTRAINT audit_log_tenant_id_required ON audit_log IS
  'Fail-closed for new rows; historical tenantless audit rows require evidence-backed backfill before VALIDATE CONSTRAINT.';

COMMENT ON CONSTRAINT security_events_tenant_id_required ON security_events IS
  'Fail-closed for new rows; historical tenantless security rows require evidence-backed backfill before VALIDATE CONSTRAINT.';

COMMIT;
