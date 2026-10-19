-- 015_supabase_grants.sql
-- C-2 note: broad grants rely on FORCE RLS as the real boundary (LEAST PRIVILEGE via policies).
-- Safe on Supabase: grant app tables to authenticated. Do NOT grant service_role to clients.
-- fiberos_app is local-only; on Supabase policies use authenticated.

grant usage on schema public to authenticated, anon;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- Future tables
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;

-- Ensure FORCE RLS where critical (idempotent)
do $$
begin
  begin
    alter table technicians force row level security;
  exception when undefined_table then null;
  end;
  begin
    alter table tickets force row level security;
  exception when undefined_table then null;
  end;
  begin
    alter table audit_log force row level security;
  exception when undefined_table then null;
  end;
  begin
    alter table evidence force row level security;
  exception when undefined_table then null;
  end;
  begin
    alter table optical_measurements force row level security;
  exception when undefined_table then null;
  end;
  begin
    alter table outbox_events force row level security;
  exception when undefined_table then null;
  end;
  begin
    alter table network_assets force row level security;
  exception when undefined_table then null;
  end;
end $$;

