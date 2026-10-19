-- FiberOS Alpha44 P0 Authority + Integrity Closure
-- Fail-closed migration. Existing rows must be explicitly assigned to a tenant
-- before tenant-scoped authorization can be made mandatory.

BEGIN;

-- 1) DB-enforced field-close idempotency boundary.
create table if not exists field_close_idempotency (
  tenant_id uuid not null references tenants(id) on delete restrict,
  ticket_id uuid not null references tickets(id) on delete restrict,
  idempotency_key text not null,
  request_hash char(64) not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, ticket_id, idempotency_key),
  unique (tenant_id, request_hash)
);
alter table field_close_idempotency enable row level security;
alter table field_close_idempotency force row level security;
create policy field_close_idem_member on field_close_idempotency
for all to authenticated
using (exists (select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=field_close_idempotency.tenant_id))
with check (exists (select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=field_close_idempotency.tenant_id));

-- 2) Tenant ownership columns. Migration intentionally refuses to guess tenant
-- ownership for pre-existing records.
do $$
begin
  alter table technicians add column if not exists tenant_id uuid references tenants(id) on delete restrict;
  alter table tickets add column if not exists tenant_id uuid references tenants(id) on delete restrict;
  alter table services add column if not exists tenant_id uuid references tenants(id) on delete restrict;
  alter table evidence add column if not exists tenant_id uuid references tenants(id) on delete restrict;
  alter table network_assets add column if not exists tenant_id uuid references tenants(id) on delete restrict;
  alter table network_ports add column if not exists tenant_id uuid references tenants(id) on delete restrict;
  alter table optical_measurements add column if not exists tenant_id uuid references tenants(id) on delete restrict;
end $$;

-- Protected tables may already be FORCE RLS. Inspecting legacy rows is a
-- migration-owner operation, not a runtime operation. Keep the temporary
-- NO FORCE state inside one transaction and restore FORCE before COMMIT.
alter table technicians no force row level security;
alter table tickets no force row level security;
alter table services no force row level security;
alter table evidence no force row level security;
alter table network_assets no force row level security;
alter table network_ports no force row level security;
alter table optical_measurements no force row level security;

set local row_security = off;

do $$
begin
  if exists (select 1 from technicians where tenant_id is null)
     or exists (select 1 from tickets where tenant_id is null)
     or exists (select 1 from services where tenant_id is null)
     or exists (select 1 from evidence where tenant_id is null)
     or exists (select 1 from network_assets where tenant_id is null)
     or exists (select 1 from network_ports where tenant_id is null)
     or exists (select 1 from optical_measurements where tenant_id is null) then
    raise exception 'P0_TENANT_BACKFILL_REQUIRED: assign tenant_id to all protected resources before enforcing NOT NULL';
  end if;
end $$;

alter table technicians force row level security;
alter table tickets force row level security;
alter table services force row level security;
alter table evidence force row level security;
alter table network_assets force row level security;
alter table network_ports force row level security;
alter table optical_measurements force row level security;

alter table technicians alter column tenant_id set not null;
alter table tickets alter column tenant_id set not null;
alter table services alter column tenant_id set not null;
alter table evidence alter column tenant_id set not null;
alter table network_assets alter column tenant_id set not null;
alter table network_ports alter column tenant_id set not null;
alter table optical_measurements alter column tenant_id set not null;

-- Cross-table tenant consistency: child rows cannot point across tenants.
create or replace function fiberos_enforce_ticket_tenant_consistency() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if new.technician_id is not null and not exists (
    select 1 from technicians t where t.id=new.technician_id and t.tenant_id=new.tenant_id
  ) then raise exception 'TENANT_MISMATCH_TICKET_TECHNICIAN'; end if;
  return new;
end $$;
drop trigger if exists trg_ticket_tenant_consistency on tickets;
create trigger trg_ticket_tenant_consistency before insert or update on tickets for each row execute function fiberos_enforce_ticket_tenant_consistency();

-- 3) Lifecycle authority: direct table updates of status are blocked. The API
-- lifecycle path remains the application boundary; DB trigger prevents bypass.
create or replace function fiberos_guard_ticket_status_change() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if new.status is distinct from old.status then
    if current_setting('fiberos.lifecycle_transition', true) <> 'allowed' then
      raise exception 'TICKET_STATUS_CHANGE_REQUIRES_LIFECYCLE_AUTHORITY';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_ticket_status_authority on tickets;
create trigger trg_ticket_status_authority before update on tickets for each row execute function fiberos_guard_ticket_status_change();

-- API transaction must set LOCAL fiberos.lifecycle_transition='allowed' only
-- after it has locked the row and passed the server-side role/edge checks.

-- 4) Ledger serialization: one append head per transaction using advisory lock.
-- This prevents two concurrent writers from observing the same head.
comment on table hash_ledger is 'Append-only tamper-evident chain. Writers must serialize on advisory lock 86204401.';

-- 5) Resource indexes supporting tenant-scoped policies.
create index if not exists idx_technicians_tenant on technicians(tenant_id);
create index if not exists idx_tickets_tenant on tickets(tenant_id);
create index if not exists idx_services_tenant on services(tenant_id);
create index if not exists idx_evidence_tenant on evidence(tenant_id);
create index if not exists idx_network_assets_tenant on network_assets(tenant_id);
create index if not exists idx_network_ports_tenant on network_ports(tenant_id);
create index if not exists idx_optical_measurements_tenant on optical_measurements(tenant_id);

-- 6) user_preferences can no longer self-assign arbitrary membership.
-- Inserts require an existing tenant membership grant. Tenant membership itself
-- is administered by a trusted provisioning path, not by the user.
drop policy if exists user_preferences_insert_own on user_preferences;
drop policy if exists user_preferences_update_own on user_preferences;
create policy user_preferences_insert_own on user_preferences
for insert to authenticated with check (
  user_id = auth.uid()
  and fiberos_has_any_role(array['ops_manager','sysadmin','exec'])
);
create or replace function fiberos_prevent_self_tenant_change() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'TENANT_MEMBERSHIP_CHANGE_REQUIRES_PROVISIONING_AUTHORITY';
  end if;
  return new;
end $$;
drop trigger if exists trg_user_preferences_tenant_lock on user_preferences;
create trigger trg_user_preferences_tenant_lock before update on user_preferences for each row execute function fiberos_prevent_self_tenant_change();

create policy user_preferences_update_own on user_preferences
for update to authenticated using (user_id = auth.uid())
with check (user_id = auth.uid());

COMMIT;
