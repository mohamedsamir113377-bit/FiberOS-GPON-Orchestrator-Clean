-- Alpha 8: model/parameter governance. Numeric truth remains external, versioned and reviewable.
create table if not exists engineering_models (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id) on delete restrict,
  model_key text not null, version text not null, equation text not null, domain jsonb not null default '{}'::jsonb,
  status text not null default 'DRAFT' check (status in ('DRAFT','CALIBRATION','VALIDATION','PROPOSED','APPROVED','SUSPENDED','RETIRED')),
  source_refs jsonb not null default '[]'::jsonb, validation jsonb,
  changed_by uuid, changed_at timestamptz not null default now(), created_at timestamptz not null default now(),
  unique(tenant_id,model_key,version)
);
create table if not exists engineering_parameters (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id) on delete restrict,
  parameter_key text not null, units text not null, value numeric(30,15) not null,
  std_uncertainty numeric(30,15), valid_min numeric(30,15), valid_max numeric(30,15),
  distribution text not null default 'normal' check (distribution in ('normal','lognormal','empirical','deterministic')),
  correlation_group text, source_ref text not null, provenance jsonb not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','CALIBRATION','VALIDATION','PROPOSED','APPROVED','SUSPENDED','RETIRED')),
  changed_by uuid, changed_at timestamptz not null default now(), created_at timestamptz not null default now(),
  check (std_uncertainty is null or std_uncertainty > 0), check (valid_min is null or valid_max is null or valid_min <= valid_max),
  check (valid_min is null or value >= valid_min), check (valid_max is null or value <= valid_max)
);
create unique index if not exists engineering_parameters_active_uniq on engineering_parameters(tenant_id,parameter_key) where status='APPROVED';
create index if not exists engineering_models_lookup on engineering_models(tenant_id,model_key,version,status);

alter table engineering_models enable row level security; alter table engineering_models force row level security;
alter table engineering_parameters enable row level security; alter table engineering_parameters force row level security;
drop policy if exists engineering_models_member on engineering_models;
create policy engineering_models_member on engineering_models for select to authenticated using (exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=engineering_models.tenant_id));
drop policy if exists engineering_models_write on engineering_models;
create policy engineering_models_write on engineering_models for insert to authenticated with check (status <> 'APPROVED' or (fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']) and changed_by=auth.uid()) );
drop policy if exists engineering_parameters_member on engineering_parameters;
create policy engineering_parameters_member on engineering_parameters for select to authenticated using (exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=engineering_parameters.tenant_id));
drop policy if exists engineering_parameters_write on engineering_parameters;
create policy engineering_parameters_write on engineering_parameters for insert to authenticated with check (status <> 'APPROVED' or (fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']) and changed_by=auth.uid()));
