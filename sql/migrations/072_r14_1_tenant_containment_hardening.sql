-- FiberOS R14.1 — tenant containment hardening for legacy role-only RLS branches.
-- Purpose: prevent management-role predicates from becoming cross-tenant grants.
-- Every management exception below is explicitly AND-bound to the caller's tenant membership.
-- No cross-tenant administrator semantic is permitted by these policies.

BEGIN;

-- Technician position rows do not carry tenant_id; derive tenant ownership from the technician's
-- membership and require the target technician to be in one of the caller's tenant memberships.
DROP POLICY IF EXISTS technician_positions_select_scope ON technician_positions;
CREATE POLICY technician_positions_select_scope ON technician_positions
FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1
    FROM technicians t
    JOIN user_preferences up ON up.user_id = t.user_id
    WHERE t.id = technician_positions.technician_id
      AND up.tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
      AND fiberos_has_any_role(ARRAY['field_tech','team_lead','qc','ops_manager','area_supervisor','exec','dispatcher','sysadmin'])
  )
);

DROP POLICY IF EXISTS technician_positions_insert_owner_or_management ON technician_positions;
CREATE POLICY technician_positions_insert_owner_or_management ON technician_positions
FOR INSERT TO authenticated WITH CHECK (
  EXISTS (
    SELECT 1
    FROM technicians t
    JOIN user_preferences up ON up.user_id = t.user_id
    WHERE t.id = technician_positions.technician_id
      AND up.tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
      AND (t.user_id = auth.uid() OR fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','dispatcher','sysadmin']))
  )
);
ALTER TABLE technician_positions FORCE ROW LEVEL SECURITY;

-- Inventory is tenant-scoped. Management roles are not global super-admins at the RLS layer.
DROP POLICY IF EXISTS inventory_items_member ON inventory_items;
CREATE POLICY inventory_items_member ON inventory_items
FOR SELECT TO authenticated USING (
  tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
  AND fiberos_has_any_role(ARRAY['exec','ops_manager','area_supervisor','warehouse','sysadmin'])
);

DROP POLICY IF EXISTS inventory_transactions_member ON inventory_transactions;
CREATE POLICY inventory_transactions_member ON inventory_transactions
FOR SELECT TO authenticated USING (
  tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
  AND fiberos_has_any_role(ARRAY['exec','ops_manager','area_supervisor','warehouse','sysadmin'])
);
ALTER TABLE inventory_items FORCE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_accounts_own ON customer_accounts;
CREATE POLICY customer_accounts_own ON customer_accounts
FOR SELECT TO authenticated USING (
  tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
  AND (user_id = auth.uid() OR fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','exec','sysadmin','call_center']))
);
ALTER TABLE customer_accounts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoices_tenant_scope ON invoices;
CREATE POLICY invoices_tenant_scope ON invoices
FOR SELECT TO authenticated USING (
  tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
  AND fiberos_has_any_role(ARRAY['cfo','exec','ops_manager','call_center','sysadmin'])
);
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_cycles_tenant_scope ON payment_cycles;
CREATE POLICY payment_cycles_tenant_scope ON payment_cycles
FOR SELECT TO authenticated USING (
  tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
  AND fiberos_has_any_role(ARRAY['cfo','exec','ops_manager','sysadmin'])
);

DROP POLICY IF EXISTS payment_cycle_events_tenant_scope ON payment_cycle_events;
CREATE POLICY payment_cycle_events_tenant_scope ON payment_cycle_events
FOR SELECT TO authenticated USING (
  tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
  AND fiberos_has_any_role(ARRAY['cfo','exec','ops_manager','sysadmin'])
);
ALTER TABLE payment_cycles FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_cycle_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rework_cases_tenant_scope ON rework_cases;
CREATE POLICY rework_cases_tenant_scope ON rework_cases
FOR SELECT TO authenticated USING (
  tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
  AND fiberos_has_any_role(ARRAY['exec','ops_manager','area_supervisor','qc','sysadmin'])
);

DROP POLICY IF EXISTS rework_case_events_tenant_scope ON rework_case_events;
CREATE POLICY rework_case_events_tenant_scope ON rework_case_events
FOR SELECT TO authenticated USING (
  tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
  AND fiberos_has_any_role(ARRAY['exec','ops_manager','area_supervisor','qc','sysadmin'])
);
ALTER TABLE rework_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE rework_case_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS routing_requests_select_scope ON routing_requests;
CREATE POLICY routing_requests_select_scope ON routing_requests
FOR SELECT TO authenticated USING (
  tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
  AND fiberos_has_any_role(ARRAY['exec','sysadmin'])
);
ALTER TABLE routing_requests FORCE ROW LEVEL SECURITY;

COMMIT;
