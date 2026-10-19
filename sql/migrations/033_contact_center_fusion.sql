-- Wave5 Contact Center Fusion foundation
create table if not exists contact_center_agent_presence (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null,
 agent_id uuid not null,
 status text not null,
 updated_at timestamptz not null default now(),
 unique(tenant_id,agent_id),
 check(status in ('AVAILABLE','BUSY','AWAY','OFFLINE'))
);
create index if not exists idx_cc_presence_tenant_status on contact_center_agent_presence(tenant_id,status);
alter table contact_center_agent_presence enable row level security;
alter table contact_center_agent_presence force row level security;
drop policy if exists cc_presence_select_tenant on contact_center_agent_presence;
create policy cc_presence_select_tenant on contact_center_agent_presence
for select to authenticated using (
  tenant_id = fiberos_current_tenant_id()
  and (agent_id = auth.uid() or fiberos_has_any_role(array['call_center','ops_manager','area_supervisor','exec','sysadmin']))
);
drop policy if exists cc_presence_write_own on contact_center_agent_presence;
create policy cc_presence_write_own on contact_center_agent_presence
for insert to authenticated with check (
  tenant_id = fiberos_current_tenant_id()
  and agent_id = auth.uid()
  and fiberos_has_any_role(array['call_center','ops_manager','area_supervisor','sysadmin'])
);
drop policy if exists cc_presence_update_own on contact_center_agent_presence;
create policy cc_presence_update_own on contact_center_agent_presence
for update to authenticated using (
  tenant_id = fiberos_current_tenant_id()
  and agent_id = auth.uid()
  and fiberos_has_any_role(array['call_center','ops_manager','area_supervisor','sysadmin'])
) with check (
  tenant_id = fiberos_current_tenant_id()
  and agent_id = auth.uid()
  and fiberos_has_any_role(array['call_center','ops_manager','area_supervisor','sysadmin'])
);
