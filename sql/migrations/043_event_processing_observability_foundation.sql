-- Wave 13: Event processing observability foundation
-- No broker, publisher, or consumer is claimed by this migration.

create table if not exists event_processing_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  event_id uuid not null,
  status text not null check (status in ('READY','PROCESSED','FAILED','RETRYABLE')),
  attempt_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_event_processing_attempts_tenant_status on event_processing_attempts(tenant_id,status);
create unique index if not exists idx_event_processing_attempts_event on event_processing_attempts(tenant_id,event_id);


alter table event_processing_attempts enable row level security;
alter table event_processing_attempts force row level security;
drop policy if exists event_processing_attempts_tenant_read on event_processing_attempts;
create policy event_processing_attempts_tenant_read on event_processing_attempts
for select to authenticated using (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','exec','sysadmin']));
drop policy if exists event_processing_attempts_tenant_write on event_processing_attempts;
create policy event_processing_attempts_tenant_write on event_processing_attempts
for insert to authenticated with check (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','sysadmin']));
drop policy if exists event_processing_attempts_tenant_update on event_processing_attempts;
create policy event_processing_attempts_tenant_update on event_processing_attempts
for update to authenticated using (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','sysadmin']))
with check (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','sysadmin']));
