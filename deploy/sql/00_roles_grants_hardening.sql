-- FiberOS R14.1 — role separation + RLS hardening assertion (DB layer).
-- Run as a cluster administrator AFTER sql/bootstrap/00_production_roles.sql,
-- 02_extension_bootstrap.sql, 01_production_auth_shim.sql and the 111 migrations.
-- Idempotent. Read-only except for role attributes.

-- 1. Roles referenced by the migrations but not created by bootstrap.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fiberos_backup') THEN
    CREATE ROLE fiberos_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

-- 2. Fail closed: no runtime identity may be SUPERUSER or BYPASSRLS.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
           FROM pg_roles WHERE rolname IN
             ('fiberos_owner','fiberos_app','fiberos_migrator','fiberos_runtime','fiberos_worker','authenticated','anon')
  LOOP
    IF r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole THEN
      RAISE EXCEPTION 'PRIVILEGE_CONTRACT_VIOLATION: role % has super=%, bypassrls=%, createdb=%, createrole=%',
        r.rolname, r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole;
    END IF;
  END LOOP;
END $$;

-- 3. Runtime identities keep USAGE on public but never CREATE.
REVOKE CREATE ON SCHEMA public FROM fiberos_runtime, fiberos_worker, fiberos_app;
GRANT USAGE ON SCHEMA public TO fiberos_runtime, fiberos_worker, fiberos_app;
-- Migrations run as fiberos_owner via SET ROLE (one migration session).
GRANT USAGE, CREATE ON SCHEMA public TO fiberos_owner;

-- 4. Only the deployment identity may assume ownership; only the API may assume fiberos_app.
REVOKE fiberos_owner FROM fiberos_runtime, fiberos_worker, fiberos_app;
GRANT fiberos_owner TO fiberos_migrator;
GRANT fiberos_app TO fiberos_runtime;
-- The migration history is not readable by runtime identities.
DO $$
BEGIN
  IF to_regclass('public.fiberos_migration_history') IS NOT NULL THEN
    REVOKE ALL ON public.fiberos_migration_history FROM public, fiberos_runtime, fiberos_worker, fiberos_app;
    GRANT SELECT ON public.fiberos_migration_history TO fiberos_migrator;
  END IF;
END $$;

-- 5. Assert that every tenant-sensitive table carries ENABLE + FORCE row level security.
-- The inventory is generated from the migrations; this is the runtime cross-check.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT jsonb_array_elements(
             (pg_read_file(current_setting('fiberos.rls_inventory_path'))::jsonb)->'tables'
           )->>'table'
  LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relname = t)
       AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                       WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity AND c.relforcerowsecurity)
    THEN
      RAISE EXCEPTION 'RLS_FORCE_MISSING: %', t;
    END IF;
  END LOOP;
END $$;
