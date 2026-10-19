-- Ensure roles exist on plain Postgres (Supabase already has them)
-- 009_rls_core.sql
-- RLS technicians tickets audit
-- FiberOS migration — apply in order
-- Requires: Postgres 15+, extensions from 001

-- ---------------------------------------------------------------------
alter table technicians enable row level security;
alter table tickets enable row level security;
alter table audit_log enable row level security;

-- Remove prior policies so this migration is deterministic.
do $$
declare p record;
begin
  for p in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('technicians','tickets','audit_log')
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- technicians: users can read their own mapping; management can administer.
create policy technicians_select_own_or_management on technicians
for select using (
  user_id = auth.uid()
  or fiberos_has_any_role(array['ops_manager','area_supervisor','exec','sysadmin','dispatcher','qc'])
);

create policy technicians_insert_management on technicians
for insert with check (
  fiberos_has_any_role(array['ops_manager','sysadmin'])
);

create policy technicians_update_own_or_management on technicians
for update using (
  user_id = auth.uid()
  or fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin'])
) with check (
  user_id = auth.uid()
  or fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin'])
);

create policy technicians_delete_sysadmin on technicians
for delete using (fiberos_has_role('sysadmin'));

-- tickets: ownership is resolved through technicians.user_id.
create policy tickets_select_owned_or_management on tickets
for select using (
  fiberos_ticket_is_owned(technician_id)
  or fiberos_has_any_role(array['qc','ops_manager','area_supervisor','exec','sysadmin'])
);

create policy tickets_insert_field_or_management on tickets
for insert with check (
  fiberos_ticket_is_owned(technician_id)
  or fiberos_has_any_role(array['qc','ops_manager','area_supervisor','sysadmin'])
);

create policy tickets_update_owned_or_qc_management on tickets
for update using (
  fiberos_ticket_is_owned(technician_id)
  or fiberos_has_any_role(array['qc','ops_manager','area_supervisor','sysadmin'])
) with check (
  fiberos_ticket_is_owned(technician_id)
  or fiberos_has_any_role(array['qc','ops_manager','area_supervisor','sysadmin'])
);

create policy tickets_delete_management on tickets
for delete using (fiberos_has_any_role(array['ops_manager','sysadmin']));

-- audit_log: append-only for authenticated actors; no UPDATE/DELETE policies.
create policy audit_insert_authenticated on audit_log
for insert with check (
  auth.uid() is not null
  and (actor_id is null or actor_id = auth.uid())
);

create policy audit_select_management on audit_log
for select using (
  fiberos_has_any_role(array['qc','ops_manager','area_supervisor','exec','sysadmin'])
);

-- Explicitly revoke table-level mutations that RLS should never grant.
revoke update, delete on audit_log from anon, authenticated;

-- ---------------------------------------------------------------------

