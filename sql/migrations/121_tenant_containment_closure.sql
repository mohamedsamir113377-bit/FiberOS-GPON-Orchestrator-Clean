-- 121_tenant_containment_closure.sql
-- Security closure for the migration-117 field-operations SELECT regression.
-- SELECT visibility is tenant-bound; management role checks remain only on mutation policies.
-- This migration intentionally does not alter migration 117, preserving an auditable append-only chain.
BEGIN;

DROP POLICY IF EXISTS network_cards_scope ON network_cards;
CREATE POLICY network_cards_scope ON network_cards
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM network_assets a
    WHERE a.id = network_cards.asset_id
      AND a.tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
  )
);

DROP POLICY IF EXISTS technician_role_assignments_scope ON technician_role_assignments;
CREATE POLICY technician_role_assignments_scope ON technician_role_assignments
FOR SELECT
USING (
  tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS ticket_worker_assignments_scope ON ticket_worker_assignments;
CREATE POLICY ticket_worker_assignments_scope ON ticket_worker_assignments
FOR SELECT
USING (
  tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS splice_records_scope ON splice_records;
CREATE POLICY splice_records_scope ON splice_records
FOR SELECT
USING (
  tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
);

COMMENT ON POLICY network_cards_scope ON network_cards IS
  'Tenant-contained SELECT closure for migration-117 regression; management role is not a cross-tenant visibility grant.';
COMMENT ON POLICY technician_role_assignments_scope ON technician_role_assignments IS
  'Tenant-contained SELECT closure for migration-117 regression; management role is not a cross-tenant visibility grant.';
COMMENT ON POLICY ticket_worker_assignments_scope ON ticket_worker_assignments IS
  'Tenant-contained SELECT closure for migration-117 regression; management role is not a cross-tenant visibility grant.';
COMMENT ON POLICY splice_records_scope ON splice_records IS
  'Tenant-contained SELECT closure for migration-117 regression; management role is not a cross-tenant visibility grant.';

COMMIT;
