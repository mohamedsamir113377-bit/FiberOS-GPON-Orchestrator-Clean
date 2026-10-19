-- Wave 12: Secure Event Fabric Foundation
-- Contract preparation only. No broker, no live streaming, no synthetic events.

create table if not exists event_outbox_contract (
  event_id uuid primary key,
  tenant_id uuid not null,
  aggregate_type text not null,
  aggregate_id text not null,
  event_type text not null,
  payload_version text not null default '1',
  correlation_id text not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_event_outbox_contract_tenant_time
on event_outbox_contract(tenant_id, occurred_at desc);


alter table event_outbox_contract enable row level security;
alter table event_outbox_contract force row level security;
drop policy if exists event_outbox_contract_tenant_read on event_outbox_contract;
create policy event_outbox_contract_tenant_read on event_outbox_contract
for select to authenticated using (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','exec','sysadmin']));
drop policy if exists event_outbox_contract_tenant_write on event_outbox_contract;
create policy event_outbox_contract_tenant_write on event_outbox_contract
for insert to authenticated with check (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','sysadmin']));
