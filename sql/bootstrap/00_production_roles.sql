-- FiberOS production role bootstrap — cluster administrator phase.
-- Run before production migrations. No application/runtime secret is stored here.
-- The bootstrap establishes identities only; object-specific grants that depend
-- on migrated tables are applied by sql/bootstrap/20_runtime_role_grants.sql.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fiberos_owner') THEN
    CREATE ROLE fiberos_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  ELSE
    ALTER ROLE fiberos_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fiberos_app') THEN
    CREATE ROLE fiberos_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT;
  ELSE
    ALTER ROLE fiberos_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fiberos_migrator') THEN
    CREATE ROLE fiberos_migrator LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  ELSE
    ALTER ROLE fiberos_migrator LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fiberos_runtime') THEN
    CREATE ROLE fiberos_runtime LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  ELSE
    ALTER ROLE fiberos_runtime LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fiberos_worker') THEN
    CREATE ROLE fiberos_worker LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  ELSE
    ALTER ROLE fiberos_worker LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

-- This role owns fixed SECURITY DEFINER RLS predicates and the tenant resolver.
-- It is non-login/non-superuser and receives only scoped/column-level SELECT.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fiberos_policy_reader') THEN
    CREATE ROLE fiberos_policy_reader NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  ELSE
    ALTER ROLE fiberos_policy_reader NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

-- Explicit membership boundary: only the deployment identity may assume object ownership,
-- and only the API runtime may assume the constrained application role. The worker is
-- deliberately isolated from both. REVOKE is idempotent and fails closed only if an
-- administrator later attempts to introduce an unintended privilege path.
REVOKE fiberos_owner FROM fiberos_runtime, fiberos_worker, fiberos_app;
REVOKE fiberos_app FROM fiberos_worker, fiberos_migrator, fiberos_app;
REVOKE fiberos_policy_reader FROM fiberos_runtime, fiberos_worker, fiberos_app, fiberos_migrator;

GRANT fiberos_owner TO fiberos_migrator;
GRANT fiberos_policy_reader TO fiberos_owner WITH ADMIN OPTION;
GRANT fiberos_app TO fiberos_runtime;
-- Temporary migration capability for defining its SECURITY DEFINER predicate;
-- removed by the post-migration DBA grants/hardening script.
GRANT USAGE, CREATE ON SCHEMA public TO fiberos_policy_reader;

-- Runtime identities cannot create arbitrary application objects.
REVOKE CREATE ON SCHEMA public FROM fiberos_runtime, fiberos_worker, fiberos_app;
GRANT USAGE ON SCHEMA public TO fiberos_runtime, fiberos_worker, fiberos_app;
-- Migrations execute under fiberos_owner. Grant only the schema privileges
-- needed to create/alter application objects; runtime identities remain denied.
GRANT USAGE, CREATE ON SCHEMA public TO fiberos_owner;
