-- FiberOS Alpha44 P0 follow-up: tenant-scoped DB authority.
-- Purpose: close cross-tenant authorization gaps left by legacy role-only RLS.
-- Fail-closed: authenticated clients do not provision/change tenant membership.

create or replace function fiberos_current_tenant_id()
returns uuid
language sql stable security invoker
set search_path = pg_catalog, public, auth
as $$
  select up.tenant_id
  from public.user_preferences up
  where up.user_id = auth.uid()
  limit 1;
$$;

-- -------------------------------------------------------------------------
-- user_preferences is both a user-preference row and the legacy membership
-- anchor. Tenant membership must therefore be provisioned by a trusted
-- backend/service path, never self-assigned by an authenticated client.
-- -------------------------------------------------------------------------
drop policy if exists user_preferences_insert_own on user_preferences;
drop policy if exists user_preferences_update_own on user_preferences;
drop policy if exists user_preferences_delete_own on user_preferences;

-- Authenticated users may update presentation-only preferences on their own
-- row, but tenant_id must remain exactly the already-provisioned value.
create policy user_preferences_update_own on user_preferences
for update to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and tenant_id = fiberos_current_tenant_id()
);

-- No INSERT/DELETE policy for authenticated. Provisioning is a trusted path.

-- -------------------------------------------------------------------------
-- Tenant-scoped policies for resources that previously admitted broad
-- authenticated/management access.
-- -------------------------------------------------------------------------

-- technicians
 drop policy if exists technicians_select_own_or_management on technicians;
 drop policy if exists technicians_insert_management on technicians;
 drop policy if exists technicians_update_own_or_management on technicians;
 drop policy if exists technicians_delete_sysadmin on technicians;
create policy technicians_select_tenant on technicians
for select to authenticated using (
  tenant_id = fiberos_current_tenant_id()
  and (user_id = auth.uid() or fiberos_has_any_role(array['ops_manager','area_supervisor','exec','sysadmin','dispatcher','qc']))
);
create policy technicians_insert_tenant_management on technicians
for insert to authenticated with check (
  tenant_id = fiberos_current_tenant_id()
  and fiberos_has_any_role(array['ops_manager','sysadmin'])
);
create policy technicians_update_tenant_management on technicians
for update to authenticated
using (tenant_id = fiberos_current_tenant_id() and (user_id = auth.uid() or fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin'])))
with check (tenant_id = fiberos_current_tenant_id() and (user_id = auth.uid() or fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin'])));
create policy technicians_delete_tenant_sysadmin on technicians
for delete to authenticated using (tenant_id = fiberos_current_tenant_id() and fiberos_has_role('sysadmin'));

-- tickets: ownership OR management, but always inside caller tenant.
drop policy if exists tickets_select_owned_or_management on tickets;
drop policy if exists tickets_insert_field_or_management on tickets;
drop policy if exists tickets_update_owned_or_qc_management on tickets;
drop policy if exists tickets_delete_management on tickets;
create policy tickets_select_tenant on tickets
for select to authenticated using (
  tenant_id = fiberos_current_tenant_id()
  and (fiberos_ticket_is_owned(technician_id) or fiberos_has_any_role(array['qc','ops_manager','area_supervisor','exec','sysadmin']))
);
create policy tickets_insert_tenant on tickets
for insert to authenticated with check (
  tenant_id = fiberos_current_tenant_id()
  and (fiberos_ticket_is_owned(technician_id) or fiberos_has_any_role(array['qc','ops_manager','area_supervisor','sysadmin']))
);
-- IMPORTANT: status authority is separated from generic row updates. The
-- lifecycle SECURITY DEFINER function is the only client-callable status path.
create policy tickets_update_tenant_nonstatus on tickets
for update to authenticated
using (
  tenant_id = fiberos_current_tenant_id()
  and (fiberos_ticket_is_owned(technician_id) or fiberos_has_any_role(array['qc','ops_manager','area_supervisor','sysadmin']))
)
with check (
  tenant_id = fiberos_current_tenant_id()
  and status = (select t2.status from tickets t2 where t2.id = tickets.id)
  and (fiberos_ticket_is_owned(technician_id) or fiberos_has_any_role(array['qc','ops_manager','area_supervisor','sysadmin']))
);
create policy tickets_delete_tenant_management on tickets
for delete to authenticated using (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','sysadmin']));

-- services
alter table services enable row level security;
alter table services force row level security;
drop policy if exists services_member on services;
drop policy if exists services_management on services;
create policy services_tenant on services
for all to authenticated
using (tenant_id = fiberos_current_tenant_id())
with check (tenant_id = fiberos_current_tenant_id());

-- evidence: tenant must equal the ticket tenant and caller tenant.
drop policy if exists evidence_select_owned_or_management on evidence;
drop policy if exists evidence_insert_field_or_management on evidence;
create policy evidence_select_tenant on evidence
for select to authenticated using (
  tenant_id = fiberos_current_tenant_id()
  and exists (select 1 from tickets tk where tk.id=evidence.ticket_id and tk.tenant_id=evidence.tenant_id
    and (fiberos_ticket_is_owned(tk.technician_id) or fiberos_has_any_role(array['qc','ops_manager','area_supervisor','exec','sysadmin'])))
);
create policy evidence_insert_tenant on evidence
for insert to authenticated with check (
  tenant_id = fiberos_current_tenant_id()
  and exists (select 1 from tickets tk where tk.id=evidence.ticket_id and tk.tenant_id=evidence.tenant_id
    and (fiberos_ticket_is_owned(tk.technician_id) or fiberos_has_any_role(array['qc','ops_manager','area_supervisor','sysadmin'])))
);

-- network assets / ports / optical measurements
drop policy if exists network_assets_read_authenticated on network_assets;
drop policy if exists network_assets_write_management on network_assets;
create policy network_assets_tenant_read on network_assets for select to authenticated using (tenant_id=fiberos_current_tenant_id());
create policy network_assets_tenant_write on network_assets for all to authenticated
using (tenant_id=fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']))
with check (tenant_id=fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']));

drop policy if exists network_ports_read_authenticated on network_ports;
drop policy if exists network_ports_write_management on network_ports;
create policy network_ports_tenant_read on network_ports for select to authenticated using (tenant_id=fiberos_current_tenant_id());
create policy network_ports_tenant_write on network_ports for all to authenticated
using (tenant_id=fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']))
with check (tenant_id=fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']));

drop policy if exists optical_measurements_read_authenticated on optical_measurements;
drop policy if exists optical_measurements_insert_field_or_management on optical_measurements;
create policy optical_measurements_tenant_read on optical_measurements for select to authenticated using (tenant_id=fiberos_current_tenant_id());
create policy optical_measurements_tenant_insert on optical_measurements for insert to authenticated with check (
  tenant_id=fiberos_current_tenant_id()
  and (fiberos_ticket_is_owned(measured_by) or fiberos_has_any_role(array['qc','ops_manager','area_supervisor','sysadmin']))
);

-- -------------------------------------------------------------------------
-- Cross-table tenant consistency for topology and measurement references.
-- -------------------------------------------------------------------------
create or replace function fiberos_enforce_resource_tenant_consistency() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if tg_table_name='network_ports' then
    if not exists(select 1 from network_assets a where a.id=new.asset_id and a.tenant_id=new.tenant_id) then
      raise exception 'TENANT_MISMATCH_NETWORK_PORT_ASSET';
    end if;
    if new.connected_asset_id is not null and not exists(select 1 from network_assets a where a.id=new.connected_asset_id and a.tenant_id=new.tenant_id) then
      raise exception 'TENANT_MISMATCH_NETWORK_PORT_CONNECTED_ASSET';
    end if;
  elsif tg_table_name='optical_measurements' then
    if new.asset_id is not null and not exists(select 1 from network_assets a where a.id=new.asset_id and a.tenant_id=new.tenant_id) then
      raise exception 'TENANT_MISMATCH_MEASUREMENT_ASSET';
    end if;
    if new.port_id is not null and not exists(select 1 from network_ports p where p.id=new.port_id and p.tenant_id=new.tenant_id) then
      raise exception 'TENANT_MISMATCH_MEASUREMENT_PORT';
    end if;
    if new.measured_by is not null and not exists(select 1 from technicians t where t.id=new.measured_by and t.tenant_id=new.tenant_id) then
      raise exception 'TENANT_MISMATCH_MEASUREMENT_TECHNICIAN';
    end if;
  elsif tg_table_name='services' then
    null;
  end if;
  return new;
end $$;

drop trigger if exists trg_network_ports_tenant_consistency on network_ports;
create trigger trg_network_ports_tenant_consistency before insert or update on network_ports for each row execute function fiberos_enforce_resource_tenant_consistency();
drop trigger if exists trg_optical_measurements_tenant_consistency on optical_measurements;
create trigger trg_optical_measurements_tenant_consistency before insert or update on optical_measurements for each row execute function fiberos_enforce_resource_tenant_consistency();


-- Outbox rows are tenant-scoped too. Legacy rows must be explicitly resolved;
-- this migration never guesses tenant ownership from incomplete metadata.
alter table outbox_events add column if not exists tenant_id uuid references tenants(id) on delete restrict;
do $$
begin
  if exists (select 1 from outbox_events where tenant_id is null) then
    raise exception 'P0_OUTBOX_TENANT_BACKFILL_REQUIRED: assign tenant_id to all existing outbox rows';
  end if;
end $$;
alter table outbox_events alter column tenant_id set not null;
create index if not exists idx_outbox_tenant_status on outbox_events(tenant_id,publish_status,created_at);
alter table outbox_events enable row level security;
alter table outbox_events force row level security;
drop policy if exists outbox_select_management on outbox_events;
drop policy if exists outbox_insert_app on outbox_events;
drop policy if exists outbox_select_app on outbox_events;
create policy outbox_select_tenant_management on outbox_events
for select to authenticated using (
  tenant_id = fiberos_current_tenant_id()
  and fiberos_has_any_role(array['ops_manager','sysadmin','exec','dispatcher','qc'])
);
create policy outbox_insert_tenant_app on outbox_events
for insert to authenticated, fiberos_app with check (
  tenant_id = fiberos_current_tenant_id()
  and fiberos_has_any_role(array['field_tech','qc','ops_manager','dispatcher','area_supervisor','sysadmin','call_center'])
);

-- -------------------------------------------------------------------------
-- DB-authoritative ticket transition. SECURITY DEFINER is deliberately
-- narrow: it validates caller tenant + app_metadata.role + actual current
-- state, locks the ticket, and performs exactly one approved transition.
-- -------------------------------------------------------------------------
create or replace function fiberos_transition_ticket(p_ticket_id uuid, p_to text)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
declare
  v_tenant uuid;
  v_role text;
  v_from text;
  v_to text := replace(lower(trim(p_to)), '-', '_');
  v_allowed boolean := false;
begin
  v_tenant := fiberos_current_tenant_id();
  v_role := auth.jwt()->'app_metadata'->>'role';
  if v_tenant is null then raise exception 'TENANT_CONTEXT_REQUIRED'; end if;
  if v_role is null or v_role='' then raise exception 'ROLE_REQUIRED_FOR_TRANSITION'; end if;
  if v_ticket_id is null or v_to is null or v_to='' then raise exception 'TRANSITION_INPUT_REQUIRED'; end if;

  select status into v_from from tickets
  where id=p_ticket_id and tenant_id=v_tenant
  for update;
  if not found then raise exception 'TICKET_NOT_FOUND'; end if;

  -- Canonical lifecycle graph + explicit role authorization. Keep this list
  -- synchronized with packages/domain/src/ticketLifecycle.js.
  v_allowed := case
    when v_from='pending' and v_to='in_progress' and v_role in ('field_tech','dispatcher','ops_manager','sysadmin') then true
    when v_from='in_progress' and v_to='awaiting_evidence' and v_role in ('field_tech','ops_manager','sysadmin') then true
    when v_from='awaiting_evidence' and v_to='manager_review' and v_role in ('field_tech','qc','ops_manager','sysadmin') then true
    when v_from='manager_review' and v_to='completed' and v_role in ('ops_manager','qc','sysadmin','area_supervisor') then true
    when v_from='manager_review' and v_to='rejected' and v_role in ('ops_manager','qc','sysadmin') then true
    else false
  end;
  if not v_allowed then raise exception 'TRANSITION_REJECTED'; end if;

  update tickets
  set status=v_to,
      updated_at=now(),
      first_assigned_at=case
        when v_to='in_progress' and first_assigned_at is null then now()
        else first_assigned_at
      end,
      closed_at=case
        when v_to in ('completed','cancelled','rejected','faulty') and closed_at is null then now()
        when v_to not in ('completed','cancelled','rejected','faulty') then null
        else closed_at
      end
  where id=p_ticket_id and tenant_id=v_tenant and status=v_from;
  if not found then raise exception 'TICKET_NOT_UPDATED'; end if;

  return jsonb_build_object('ticket_id',p_ticket_id,'from',v_from,'to',v_to,'tenant_id',v_tenant,'role',v_role);
end $$;

revoke all on function fiberos_transition_ticket(uuid,text) from public, anon;
grant execute on function fiberos_transition_ticket(uuid,text) to authenticated;

-- Prevent direct authenticated table writes from changing status. The
-- SECURITY DEFINER transition function is the explicit authority boundary.
create or replace function fiberos_guard_ticket_status_change() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if new.status is distinct from old.status and current_user in ('authenticated','fiberos_app') then
    raise exception 'TICKET_STATUS_CHANGE_REQUIRES_DB_LIFECYCLE_FUNCTION';
  end if;
  return new;
end $$;
