-- 186_migration_history_attestation.sql
-- Expose a compact checksum commitment to runtime readiness without granting
-- the application identity SELECT access to the raw release-integrity ledger.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.fiberos_migration_history') IS NULL THEN
    RAISE EXCEPTION 'FIBEROS_MIGRATION_HISTORY_REQUIRED';
  END IF;
  IF to_regrole('fiberos_owner') IS NULL OR to_regrole('fiberos_migrator') IS NULL
     OR to_regrole('fiberos_runtime') IS NULL OR to_regrole('fiberos_app') IS NULL
     OR to_regrole('fiberos_worker') IS NULL THEN
    RAISE EXCEPTION 'FIBEROS_MIGRATION_ATTESTATION_ROLES_REQUIRED';
  END IF;
  IF to_regprocedure('public.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'FIBEROS_MIGRATION_ATTESTATION_PGCRYPTO_REQUIRED';
  END IF;
END
$$;

REVOKE ALL ON TABLE public.fiberos_migration_history
  FROM PUBLIC, anon, authenticated, fiberos_runtime, fiberos_worker, fiberos_app, fiberos_migrator;
GRANT SELECT ON TABLE public.fiberos_migration_history TO fiberos_migrator;

CREATE OR REPLACE FUNCTION public.fiberos_migration_history_attestation()
RETURNS TABLE (
  migration_count bigint,
  latest_migration text,
  ledger_sha256 text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fiberos$
  SELECT
    count(*)::bigint,
    max(migration_name COLLATE "C")::text,
    encode(
      public.digest(
        convert_to(
          coalesce(
            string_agg(
              migration_name || chr(31) || lower(sha256),
              chr(10) ORDER BY migration_name COLLATE "C"
            ),
            ''
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  FROM public.fiberos_migration_history;
$fiberos$;

ALTER FUNCTION public.fiberos_migration_history_attestation() OWNER TO fiberos_owner;
REVOKE ALL ON FUNCTION public.fiberos_migration_history_attestation()
  FROM PUBLIC, anon, authenticated, fiberos_runtime, fiberos_app, fiberos_worker, fiberos_migrator;
GRANT EXECUTE ON FUNCTION public.fiberos_migration_history_attestation() TO fiberos_runtime;
COMMENT ON FUNCTION public.fiberos_migration_history_attestation() IS
  'Returns migration ledger count, latest migration and deterministic SHA-256 commitment only; raw ledger rows remain inaccessible to runtime identities.';

DO $$
DECLARE
  v_owner text;
  v_definer boolean;
  v_config text[];
BEGIN
  SELECT pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    INTO v_owner, v_definer, v_config
    FROM pg_proc p
   WHERE p.oid = 'public.fiberos_migration_history_attestation()'::regprocedure;

  IF v_owner IS DISTINCT FROM 'fiberos_owner' OR v_definer IS DISTINCT FROM true
     OR NOT (coalesce(v_config, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public']) THEN
    RAISE EXCEPTION 'FIBEROS_MIGRATION_ATTESTATION_DEFINER_POLICY_INVALID';
  END IF;
  IF NOT has_function_privilege('fiberos_runtime', 'public.fiberos_migration_history_attestation()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FIBEROS_MIGRATION_ATTESTATION_RUNTIME_EXECUTE_REQUIRED';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS acl
    WHERE p.oid = 'public.fiberos_migration_history_attestation()'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  )
     OR has_function_privilege('anon', 'public.fiberos_migration_history_attestation()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fiberos_migration_history_attestation()', 'EXECUTE')
     OR has_function_privilege('fiberos_app', 'public.fiberos_migration_history_attestation()', 'EXECUTE')
     OR has_function_privilege('fiberos_worker', 'public.fiberos_migration_history_attestation()', 'EXECUTE')
     OR has_function_privilege('fiberos_migrator', 'public.fiberos_migration_history_attestation()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FIBEROS_MIGRATION_ATTESTATION_EXECUTE_PRIVILEGE_LEAK';
  END IF;
  IF has_table_privilege('fiberos_runtime', 'public.fiberos_migration_history', 'SELECT')
     OR has_table_privilege('fiberos_worker', 'public.fiberos_migration_history', 'SELECT')
     OR has_table_privilege('fiberos_app', 'public.fiberos_migration_history', 'SELECT')
     OR has_table_privilege('anon', 'public.fiberos_migration_history', 'SELECT')
     OR has_table_privilege('authenticated', 'public.fiberos_migration_history', 'SELECT') THEN
    RAISE EXCEPTION 'FIBEROS_MIGRATION_HISTORY_RAW_READ_PRIVILEGE_LEAK';
  END IF;
END
$$;

COMMIT;
