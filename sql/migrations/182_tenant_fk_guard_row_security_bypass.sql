-- 182_tenant_fk_guard_row_security_bypass.sql
-- Ensure generic tenant-FK guard triggers can distinguish a true cross-tenant
-- reference from a parent row hidden by the caller's RLS policies.
-- The policy reader receives only tenant_id plus the referenced FK key columns.
BEGIN;

DO $$
DECLARE
  v_role record;
  v_fk record;
BEGIN
  SELECT rolbypassrls, rolcanlogin
    INTO v_role
    FROM pg_roles
   WHERE rolname = 'fiberos_policy_reader';

  IF NOT FOUND OR v_role.rolbypassrls IS DISTINCT FROM true OR v_role.rolcanlogin IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TENANT_FK_GUARD_POLICY_READER_ROLE_INVALID'
      USING ERRCODE = '55000';
  END IF;

  FOR v_fk IN
    SELECT DISTINCT parent.relname AS parent_table, parent_key.attname AS parent_column
      FROM pg_constraint con
      JOIN pg_class child ON child.oid = con.conrelid
      JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
      JOIN pg_class parent ON parent.oid = con.confrelid
      JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
      CROSS JOIN LATERAL unnest(con.confkey) AS pk(attnum)
      JOIN pg_attribute parent_key
        ON parent_key.attrelid = con.confrelid
       AND parent_key.attnum = pk.attnum
     WHERE con.contype = 'f'
       AND child_ns.nspname = 'public'
       AND parent_ns.nspname = 'public'
       AND parent_key.attnum > 0
       AND NOT parent_key.attisdropped
       AND parent_key.attname <> 'tenant_id'
       AND EXISTS (
         SELECT 1
           FROM pg_attribute child_tenant
          WHERE child_tenant.attrelid = con.conrelid
            AND child_tenant.attname = 'tenant_id'
            AND child_tenant.attnum > 0
            AND NOT child_tenant.attisdropped
       )
       AND EXISTS (
         SELECT 1
           FROM pg_attribute parent_tenant
          WHERE parent_tenant.attrelid = con.confrelid
            AND parent_tenant.attname = 'tenant_id'
            AND parent_tenant.attnum > 0
            AND NOT parent_tenant.attisdropped
       )
     ORDER BY parent.relname, parent_key.attname
  LOOP
    EXECUTE format(
      'GRANT SELECT (tenant_id, %I) ON TABLE public.%I TO fiberos_policy_reader',
      v_fk.parent_column,
      v_fk.parent_table
    );
  END LOOP;
END;
$$;

-- Triggers must evaluate tenant consistency across RLS-hidden parent rows.
-- Ownership is transferred to the NOLOGIN BYPASSRLS policy-reader role in the
-- controlled DBA phase (sql/bootstrap/20_runtime_role_grants.sql).
ALTER FUNCTION public.fiberos_guard_fk_tenant_match() SECURITY DEFINER;
ALTER FUNCTION public.fiberos_guard_composite_fk_tenant_match() SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.fiberos_guard_fk_tenant_match()
  FROM PUBLIC, anon, authenticated, fiberos_app, fiberos_runtime, fiberos_worker, fiberos_migrator;
REVOKE ALL ON FUNCTION public.fiberos_guard_composite_fk_tenant_match()
  FROM PUBLIC, anon, authenticated, fiberos_app, fiberos_runtime, fiberos_worker, fiberos_migrator;

COMMENT ON FUNCTION public.fiberos_guard_fk_tenant_match() IS
  'Fail-closed SECURITY DEFINER trigger guard; final owner is fiberos_policy_reader and only tenant_id plus referenced key columns are readable.';
COMMENT ON FUNCTION public.fiberos_guard_composite_fk_tenant_match() IS
  'Fail-closed SECURITY DEFINER composite trigger guard; final owner is fiberos_policy_reader and only tenant_id plus referenced key columns are readable.';

COMMIT;
