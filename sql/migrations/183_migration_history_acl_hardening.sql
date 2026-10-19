-- 183_migration_history_acl_hardening.sql
-- The migration ledger is release-integrity metadata, not an application table.
-- Migration 015 grants privileges broadly on public tables, including this ledger
-- when it is created by the production migration runner. Revoke that access here.
BEGIN;

REVOKE ALL ON TABLE public.fiberos_migration_history
  FROM PUBLIC, anon, authenticated, fiberos_runtime, fiberos_worker, fiberos_app, fiberos_migrator;
GRANT SELECT ON TABLE public.fiberos_migration_history TO fiberos_migrator;

DO $$
DECLARE
  v_role text;
  v_privilege text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'fiberos_app', 'fiberos_runtime', 'fiberos_worker'] LOOP
    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege(v_role, 'public.fiberos_migration_history', v_privilege) THEN
        RAISE EXCEPTION 'FIBEROS_MIGRATION_HISTORY_APP_PRIVILEGE_LEAK:%:%', v_role, v_privilege;
      END IF;
    END LOOP;
  END LOOP;

  IF NOT has_table_privilege('fiberos_migrator', 'public.fiberos_migration_history', 'SELECT') THEN
    RAISE EXCEPTION 'FIBEROS_MIGRATION_HISTORY_MIGRATOR_READ_REQUIRED';
  END IF;

  FOREACH v_privilege IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('fiberos_migrator', 'public.fiberos_migration_history', v_privilege) THEN
      RAISE EXCEPTION 'FIBEROS_MIGRATION_HISTORY_MIGRATOR_WRITE_FORBIDDEN:%', v_privilege;
    END IF;
  END LOOP;
END
$$;

COMMIT;
