-- FiberOS production auth shim — cluster administrator phase.
-- Run after 00_production_roles.sql and before any numbered migration.
--
-- WHY THIS FILE EXISTS:
-- This project targets plain PostgreSQL 18 + PostGIS 3.6 outside Supabase,
-- but 24 migrations and 5 service files reference auth.uid() / auth.role() /
-- auth.jwt() and GRANT ... TO authenticated (and, in 015, anon). On Supabase
-- those exist automatically; on plain Postgres they do not, so every RLS
-- policy that calls auth.uid() fails with
--   ERROR: function auth.uid() does not exist
-- and every migration that runs `GRANT ... TO authenticated` fails with
--   ERROR: role "authenticated" does not exist
-- This shim reproduces the subset of Supabase's auth surface that this
-- codebase actually calls, backed by the session GUCs that
-- packages/db/src/session.js already sets via set_config():
--   request.jwt.claim.sub, request.jwt.claim.role, request.jwt.claims

CREATE SCHEMA IF NOT EXISTS auth;

-- auth.users: the identity table referenced by application foreign keys.
-- Keep the key and identity metadata types compatible with Supabase.
CREATE TABLE IF NOT EXISTS auth.users (
  id                  uuid PRIMARY KEY,
  email               text,
  encrypted_password  text,
  raw_app_meta_data   jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_user_meta_data  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email              text;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS encrypted_password text;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_app_meta_data  jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb;

-- auth.uid(): the authenticated user's id, or NULL for an unauthenticated
-- session. Mirrors Supabase's own definition (reads request.jwt.claim.sub).
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- auth.role(): the Postgres role name asserted for this session
-- (e.g. 'authenticated'). Mirrors Supabase's own definition.
CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')
$$;

-- auth.jwt(): the full decoded claims object as jsonb (used anywhere policies
-- or functions need more than sub/role, e.g. org_id/nation_iso/role_key from
-- packages/security/src/buildJwtClaims.js).
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

REVOKE ALL ON FUNCTION auth.uid() FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.role() FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.jwt() FROM PUBLIC;

-- Roles referenced by sql/migrations/015_supabase_grants.sql and by every
-- RLS policy written against auth.uid()/auth.role(). These are the two
-- Supabase session roles this project actually uses; NOLOGIN because no
-- client ever connects directly as them — fiberos_app assumes them via
-- SET LOCAL ROLE, same pattern as fiberos_app itself in
-- sql/bootstrap/00_production_roles.sql.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  ELSE
    ALTER ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  ELSE
    ALTER ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

-- fiberos_app is the only identity that ever holds a live connection
-- (see packages/db/src/session.js: `set local role fiberos_app`). It inherits
-- the RLS-scoped authenticated grants required by the application. It does
-- not inherit the anon role, which is not needed by the production runtime.
GRANT authenticated TO fiberos_app;
REVOKE anon FROM fiberos_app;

GRANT USAGE ON SCHEMA auth TO fiberos_owner, fiberos_app, fiberos_runtime, fiberos_worker, authenticated, anon, fiberos_policy_reader;

-- Application migrations declare foreign keys to auth.users, but the identity
-- table remains outside the FiberOS object-ownership boundary. Grant only the
-- REFERENCES privilege needed to declare those relationships.
GRANT REFERENCES ON TABLE auth.users TO fiberos_owner, fiberos_migrator;
GRANT EXECUTE ON FUNCTION auth.uid() TO fiberos_app, fiberos_runtime, fiberos_worker, authenticated, anon, fiberos_policy_reader;
GRANT EXECUTE ON FUNCTION auth.uid() TO fiberos_owner;
GRANT EXECUTE ON FUNCTION auth.role() TO fiberos_app, fiberos_runtime, fiberos_worker, authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.role() TO fiberos_owner;
GRANT EXECUTE ON FUNCTION auth.jwt() TO fiberos_app, fiberos_runtime, fiberos_worker, authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.jwt() TO fiberos_owner;
