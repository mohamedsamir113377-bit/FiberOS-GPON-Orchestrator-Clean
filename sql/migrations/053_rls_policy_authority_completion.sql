-- FiberOS migration 053: close tenant-scope gaps in legacy write policies.
-- Fail-closed: authenticated writes must be bound to the caller's provisioned tenant.

-- Engineering model/parameter writes previously allowed non-APPROVED inserts
-- without asserting tenant ownership. Preserve the approval rule while adding
-- the missing tenant boundary.
drop policy if exists engineering_models_write on engineering_models;
create policy engineering_models_write on engineering_models
for insert to authenticated
with check (
  tenant_id = fiberos_current_tenant_id()
  and (
    status <> 'APPROVED'
    or (fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']) and changed_by=auth.uid())
  )
);

drop policy if exists engineering_parameters_write on engineering_parameters;
create policy engineering_parameters_write on engineering_parameters
for insert to authenticated
with check (
  tenant_id = fiberos_current_tenant_id()
  and (
    status <> 'APPROVED'
    or (fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']) and changed_by=auth.uid())
  )
);

-- Customer-account reads for ordinary users are tenant-bound through their
-- provisioned membership; system roles retain explicit system-wide visibility.
drop policy if exists customer_accounts_own on customer_accounts;
create policy customer_accounts_own on customer_accounts
for select to authenticated
using (
  (
    tenant_id = fiberos_current_tenant_id()
    and user_id = auth.uid()
  )
  or fiberos_has_any_role(array['ops_manager','area_supervisor','exec','sysadmin','call_center'])
);
