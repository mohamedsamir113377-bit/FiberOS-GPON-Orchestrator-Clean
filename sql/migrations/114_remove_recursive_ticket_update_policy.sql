-- 114_remove_recursive_ticket_update_policy.sql
-- PostgreSQL rejects the old UPDATE policy's same-table status subquery with
-- SQLSTATE 42P17 during field-close non-status updates. Status authority is
-- already enforced by fiberos_guard_ticket_status_change(): only the constrained
-- fiberos_owner transition function may change status, with its transaction-local
-- lifecycle marker. Keep tenant/assignment checks here and avoid recursive RLS.

BEGIN;

SET ROLE fiberos_owner;

DROP POLICY IF EXISTS tickets_update_tenant_nonstatus ON public.tickets;
CREATE POLICY tickets_update_tenant_nonstatus ON public.tickets
FOR UPDATE TO authenticated
USING (
  tenant_id = public.fiberos_current_tenant_id()
  AND (
    public.fiberos_ticket_is_owned(technician_id)
    OR public.fiberos_has_any_role(ARRAY['qc','ops_manager','area_supervisor','sysadmin'])
  )
)
WITH CHECK (
  tenant_id = public.fiberos_current_tenant_id()
  AND (
    public.fiberos_ticket_is_owned(technician_id)
    OR public.fiberos_has_any_role(ARRAY['qc','ops_manager','area_supervisor','sysadmin'])
  )
);

COMMENT ON POLICY tickets_update_tenant_nonstatus ON public.tickets IS
  'Tenant/assignment-scoped non-status update policy. Direct status changes are rejected by fiberos_guard_ticket_status_change; authorized transitions use fiberos_transition_ticket.';

-- Keep the migration connection in the schema-owner role for the runner's
-- immediately following migration-history INSERT.
COMMIT;
