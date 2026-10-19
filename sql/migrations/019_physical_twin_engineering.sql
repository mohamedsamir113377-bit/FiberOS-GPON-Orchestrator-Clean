-- FiberOS Alpha 6: Physical Fiber/Core Digital Twin + engineering calibration registry.
-- Additive only. No browser/client field is authoritative.

create table if not exists fiber_cables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  asset_id uuid not null unique references network_assets(id) on delete restrict,
  cable_type text,
  fiber_count integer not null check (fiber_count > 0),
  route_length_m numeric(12,2) check (route_length_m is null or route_length_m >= 0),
  installed_at timestamptz,
  status text not null default 'active' check (status in ('active','degrading','critical','decommissioned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_fiber_cables_tenant on fiber_cables(tenant_id);

create table if not exists fiber_cores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  cable_id uuid not null references fiber_cables(id) on delete restrict,
  core_number integer not null check (core_number > 0),
  status text not null default 'spare' check (status in ('spliced','active','broken','spare','reserved','retired')),
  color_code text,
  service_capacity integer check (service_capacity is null or service_capacity >= 0),
  created_at timestamptz not null default now(),
  unique(cable_id, core_number)
);
create index if not exists idx_fiber_cores_cable on fiber_cores(cable_id, core_number);

create table if not exists fiber_core_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  from_core_id uuid not null references fiber_cores(id) on delete restrict,
  to_core_id uuid not null references fiber_cores(id) on delete restrict,
  relation text not null check (relation in ('splice','patch','cross_connect','splitter_leg')),
  measured_loss_db numeric(8,4) check (measured_loss_db is null or measured_loss_db >= 0),
  loss_std_db numeric(8,4) check (loss_std_db is null or loss_std_db > 0),
  status text not null default 'active' check (status in ('active','degrading','faulty','retired')),
  created_at timestamptz not null default now(),
  unique(from_core_id,to_core_id,relation)
);
create index if not exists idx_fiber_core_links_from on fiber_core_links(from_core_id);
create index if not exists idx_fiber_core_links_to on fiber_core_links(to_core_id);

create table if not exists physical_topology_edges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  from_asset_id uuid not null references network_assets(id) on delete restrict,
  to_asset_id uuid not null references network_assets(id) on delete restrict,
  relation text not null,
  capacity numeric(14,3),
  weight numeric(14,6) not null default 1 check (weight >= 0),
  shared_risk_group text,
  direction text not null default 'directed' check (direction in ('directed','undirected')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(tenant_id,from_asset_id,to_asset_id,relation)
);
create index if not exists idx_physical_edges_from on physical_topology_edges(tenant_id,from_asset_id);
create index if not exists idx_physical_edges_to on physical_topology_edges(tenant_id,to_asset_id);
create index if not exists idx_physical_edges_srg on physical_topology_edges(tenant_id,shared_risk_group);

create table if not exists engineering_calibrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  model_key text not null,
  model_version text not null,
  parameter_key text not null,
  value numeric(20,10) not null,
  units text not null,
  std_uncertainty numeric(20,10) check (std_uncertainty is null or std_uncertainty > 0),
  valid_min numeric(20,10),
  valid_max numeric(20,10),
  source_ref text not null,
  provenance jsonb not null default '{}'::jsonb,
  status text not null default 'PROPOSED' check (status in ('PROPOSED','APPROVED','RETIRED','REJECTED')),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check (valid_min is null or valid_max is null or valid_min <= valid_max),
  check (valid_min is null or value >= valid_min),
  check (valid_max is null or value <= valid_max)
);
create index if not exists idx_engineering_calibration_lookup on engineering_calibrations(tenant_id,model_key,model_version,parameter_key,status);

-- Membership-based RLS. Read is tenant-scoped; physical topology writes are management-only.
-- Calibration history is append-only. A normal member may propose; only management roles may insert APPROVED rows.
do $$ declare t text; begin
  foreach t in array array['fiber_cables','fiber_cores','fiber_core_links','physical_topology_edges','engineering_calibrations'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

drop policy if exists fiber_cables_member on fiber_cables;
create policy fiber_cables_member on fiber_cables for select to authenticated
using (exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=fiber_cables.tenant_id));
drop policy if exists fiber_cables_management_insert on fiber_cables;
create policy fiber_cables_management_insert on fiber_cables for insert to authenticated
with check (fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']) and exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=fiber_cables.tenant_id));

drop policy if exists fiber_cores_member on fiber_cores;
create policy fiber_cores_member on fiber_cores for select to authenticated
using (exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=fiber_cores.tenant_id));
drop policy if exists fiber_cores_management_insert on fiber_cores;
create policy fiber_cores_management_insert on fiber_cores for insert to authenticated
with check (fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']) and exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=fiber_cores.tenant_id));

drop policy if exists fiber_core_links_member on fiber_core_links;
create policy fiber_core_links_member on fiber_core_links for select to authenticated
using (exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=fiber_core_links.tenant_id));
drop policy if exists fiber_core_links_management_insert on fiber_core_links;
create policy fiber_core_links_management_insert on fiber_core_links for insert to authenticated
with check (fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']) and exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=fiber_core_links.tenant_id));

drop policy if exists physical_topology_edges_member on physical_topology_edges;
create policy physical_topology_edges_member on physical_topology_edges for select to authenticated
using (exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=physical_topology_edges.tenant_id));
drop policy if exists physical_topology_edges_management_insert on physical_topology_edges;
create policy physical_topology_edges_management_insert on physical_topology_edges for insert to authenticated
with check (fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']) and exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=physical_topology_edges.tenant_id));

drop policy if exists engineering_calibrations_member_select on engineering_calibrations;
create policy engineering_calibrations_member_select on engineering_calibrations for select to authenticated
using (exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=engineering_calibrations.tenant_id));
drop policy if exists engineering_calibrations_propose on engineering_calibrations;
create policy engineering_calibrations_propose on engineering_calibrations for insert to authenticated
with check (
  status = 'PROPOSED'
  and exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=engineering_calibrations.tenant_id)
);
drop policy if exists engineering_calibrations_approve on engineering_calibrations;
create policy engineering_calibrations_approve on engineering_calibrations for insert to authenticated
with check (
  status = 'APPROVED'
  and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin'])
  and approved_by = auth.uid()
  and approved_at is not null
  and exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=engineering_calibrations.tenant_id)
);

-- History is append-only: no application UPDATE/DELETE path.
do $$ declare t text; begin
  foreach t in array array['fiber_cables','fiber_cores','fiber_core_links','physical_topology_edges','engineering_calibrations'] loop
    execute format('drop trigger if exists trg_%s_immutable on %I', t, t);
    execute format('create trigger trg_%s_immutable before update or delete on %I for each row execute function fiberos_reject_history_mutation()', t, t);
  end loop;
end $$;

create or replace view engineering_calibration_approved
with (security_invoker=true) as
select distinct on (tenant_id, model_key, model_version, parameter_key)
  id, tenant_id, model_key, model_version, parameter_key, value, units, std_uncertainty,
  valid_min, valid_max, source_ref, provenance, approved_by, approved_at, created_at
from engineering_calibrations
where status = 'APPROVED'
order by tenant_id, model_key, model_version, parameter_key, created_at desc;
