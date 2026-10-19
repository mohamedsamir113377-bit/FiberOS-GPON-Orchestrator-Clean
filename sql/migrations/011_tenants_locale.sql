-- 011_tenants_locale.sql
-- multi-tenant + user locale
-- FiberOS migration — apply in order
-- Requires: Postgres 15+, extensions from 001

-- =====================================================================
-- PRODUCTIZATION: TENANT + USER LOCALE POLICY (i18n v1.0)
-- Locale is presentation-only. It MUST NOT participate in authorization,
-- ticket state transitions, evidence validation, RLS, or southbound writes.
-- =====================================================================
create table if not exists tenants (
    id              uuid primary key default gen_random_uuid(),
    name            text not null,
    slug            text unique not null,
    default_locale  text not null default 'ar'
        check (default_locale in ('ar','en','fr','tr','es','pt','de','hi','id','sw')),
    allowed_locales text[] not null default array['ar','en']::text[],
    timezone        text not null default 'Africa/Cairo',
    currency        text not null default 'EGP'
        check (char_length(currency) = 3),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    check (default_locale = any(allowed_locales))
);

create table if not exists user_preferences (
    user_id          uuid primary key references auth.users(id) on delete cascade,
    tenant_id        uuid not null references tenants(id) on delete cascade,
    preferred_locale text
        check (preferred_locale is null or preferred_locale in ('ar','en','fr','tr','es','pt','de','hi','id','sw')),
    theme            text not null default 'dark',
    notifications_enabled boolean not null default true,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

create index if not exists idx_user_preferences_tenant
    on user_preferences(tenant_id);

alter table tenants enable row level security;
alter table user_preferences enable row level security;

drop policy if exists tenants_select_member on tenants;
create policy tenants_select_member on tenants
for select using (
    exists (
        select 1 from user_preferences up
        where up.tenant_id = tenants.id
          and up.user_id = auth.uid()
    )
);

drop policy if exists tenants_update_management on tenants;
create policy tenants_update_management on tenants
for update using (
    fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin','exec'])
)
with check (
    fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin','exec'])
);

drop policy if exists user_preferences_select_own on user_preferences;
create policy user_preferences_select_own on user_preferences
for select using (user_id = auth.uid());

drop policy if exists user_preferences_insert_own on user_preferences;
create policy user_preferences_insert_own on user_preferences
for insert with check (user_id = auth.uid());

drop policy if exists user_preferences_update_own on user_preferences;
create policy user_preferences_update_own on user_preferences
for update using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists user_preferences_delete_own on user_preferences;
create policy user_preferences_delete_own on user_preferences
for delete using (user_id = auth.uid());

create or replace function fiberos_get_user_locale()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
    select coalesce(
        (
            select up.preferred_locale
            from public.user_preferences up
            where up.user_id = auth.uid()
              and up.preferred_locale is not null
              and up.preferred_locale = any(
                  coalesce(
                    (select t.allowed_locales from public.tenants t where t.id = up.tenant_id),
                    array['ar','en']::text[]
                  )
              )
            limit 1
        ),
        (
            select t.default_locale
            from public.tenants t
            join public.user_preferences up on up.tenant_id = t.id
            where up.user_id = auth.uid()
            limit 1
        ),
        'ar'
    );
$$;

revoke all on function fiberos_get_user_locale() from public, anon;
grant execute on function fiberos_get_user_locale() to authenticated;

-- =====================================================================
-- End Productization: Tenant + Locale
-- =====================================================================
