-- 005_role_helpers.sql
-- JWT role helpers + ownership
-- FiberOS migration — apply in order
-- Requires: Postgres 15+, extensions from 001

create or replace function fiberos_has_role(required_role text)
returns boolean
language sql stable security invoker
set search_path = pg_catalog, public, auth
as $$
  select coalesce((auth.jwt()->'app_metadata'->>'role') = required_role, false);
$$;

create or replace function fiberos_has_any_role(required_roles text[])
returns boolean
language sql stable security invoker
set search_path = pg_catalog, public, auth
as $$
  select coalesce((auth.jwt()->'app_metadata'->>'role') = any(required_roles), false);
$$;

create or replace function fiberos_is_own_technician(tech_id uuid)
returns boolean
language sql stable security invoker
set search_path = pg_catalog, public, auth
as $$
  select exists (
    select 1 from technicians t
    where t.id = tech_id
      and t.user_id = auth.uid()
      and t.is_active = true
  );
$$;

create or replace function fiberos_ticket_is_owned(ticket_tech_id uuid)
returns boolean
language sql stable security invoker
set search_path = pg_catalog, public, auth
as $$
  select fiberos_is_own_technician(ticket_tech_id);
$$;

-- P0 FIX (audit item 'PostGIS / nearest_technicians — no RLS linkage'):

