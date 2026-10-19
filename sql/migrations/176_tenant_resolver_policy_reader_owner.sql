-- 176_tenant_resolver_policy_reader_owner.sql
-- Pre-conditions for the tenant resolver ownership hand-off.
-- ALTER FUNCTION OWNER TO requires the current function owner (or superuser).
-- CI applies migrations as fiberos_migrator under SET ROLE fiberos_owner; the
-- function may not be owned by fiberos_owner, so the actual OWNER TO is applied
-- as postgres in sql/bootstrap/20_runtime_role_grants.sql after the chain.
-- This migration only asserts the policy-reader role shape and grants the
-- minimum column SELECT needed for the SECURITY DEFINER body.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'fiberos_policy_reader'
      AND rolcanlogin = false
      AND rolsuper = false
      AND rolbypassrls = true
      AND rolcreatedb = false
      AND rolcreaterole = false
  ) THEN
    RAISE EXCEPTION 'FIBEROS_POLICY_READER_ROLE_UNSAFE';
  END IF;
END
$$;

-- BYPASSRLS does not grant table privileges; column-scoped SELECT is required.
GRANT SELECT (user_id, tenant_id) ON public.user_preferences TO fiberos_policy_reader;

DO $$
BEGIN
  IF NOT has_column_privilege(
    'fiberos_policy_reader',
    'public.user_preferences',
    'user_id',
    'SELECT'
  ) OR NOT has_column_privilege(
    'fiberos_policy_reader',
    'public.user_preferences',
    'tenant_id',
    'SELECT'
  ) THEN
    RAISE EXCEPTION 'FIBEROS_POLICY_READER_TENANT_COLUMNS_REQUIRED';
  END IF;
END
$$;

COMMENT ON FUNCTION public.fiberos_current_tenant_id() IS
  'Returns the authenticated principal tenant from user_preferences. Ownership is assigned to fiberos_policy_reader (NOLOGIN BYPASSRLS) in sql/bootstrap/20_runtime_role_grants.sql after migrations.';

COMMIT;
