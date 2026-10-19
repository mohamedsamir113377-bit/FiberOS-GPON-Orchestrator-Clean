-- 113_break_technician_policy_recursion.sql
-- Break the recursive RLS cycle in the supervisor field-scope policies.
--
-- technicians_field_self_select and technician_subordinates_scope_select
-- previously queried technicians from their own RLS expressions. PostgreSQL
-- correctly rejects that cycle with SQLSTATE 42P17. A dedicated NOLOGIN role
-- owns one fixed SECURITY DEFINER predicate. It has BYPASSRLS, but only SELECT
-- on the scope tables plus tenant-resolution columns; it cannot log in or mutate data. The
-- deployment owner can SET ROLE to this bootstrap-created owner when installing
-- the function. Runtime roles receive EXECUTE on the boolean predicate only.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fiberos_policy_reader') THEN
    RAISE EXCEPTION 'FIBEROS_POLICY_READER_ROLE_REQUIRED: run sql/bootstrap/00_production_roles.sql first';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'fiberos_policy_reader'
      AND rolcanlogin = false
      AND rolbypassrls = true
      AND rolsuper = false
      AND rolcreatedb = false
      AND rolcreaterole = false
  ) THEN
    RAISE EXCEPTION 'FIBEROS_POLICY_READER_ROLE_UNSAFE';
  END IF;
END
$$;

GRANT SELECT ON public.technicians, public.technician_subordinates TO fiberos_policy_reader;
GRANT SELECT (user_id, tenant_id) ON public.user_preferences TO fiberos_policy_reader;
GRANT EXECUTE ON FUNCTION public.fiberos_current_tenant_id() TO fiberos_policy_reader;

SET ROLE fiberos_policy_reader;
CREATE OR REPLACE FUNCTION public.fiberos_field_technician_scope(p_technician_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
SET row_security = off
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.technicians AS target
    WHERE target.id = p_technician_id
      AND target.tenant_id = public.fiberos_current_tenant_id()
      AND (
        target.user_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.technician_subordinates AS ts
          JOIN public.technicians AS supervisor
            ON supervisor.id = ts.supervisor_technician_id
          WHERE ts.tenant_id = target.tenant_id
            AND ts.subordinate_technician_id = target.id
            AND ts.is_active = true
            AND supervisor.tenant_id = target.tenant_id
            AND supervisor.user_id = auth.uid()
        )
      )
  );
END
$$;

REVOKE ALL ON FUNCTION public.fiberos_field_technician_scope(uuid) FROM PUBLIC, anon, fiberos_runtime, fiberos_worker, fiberos_app, fiberos_owner;
GRANT EXECUTE ON FUNCTION public.fiberos_field_technician_scope(uuid) TO authenticated;
COMMENT ON FUNCTION public.fiberos_field_technician_scope(uuid) IS
  'Boolean-only, tenant-bound field/supervisor scope predicate. Owned by the NOLOGIN BYPASSRLS fiberos_policy_reader role to prevent recursive technicians RLS evaluation; only authenticated sessions may execute it.';

SET ROLE fiberos_owner;
-- Policy-reader membership is bootstrap-only and is revoked after migrations
-- by sql/bootstrap/20_runtime_role_grants.sql (runs as cluster admin).
DROP POLICY IF EXISTS technicians_field_self_select ON public.technicians;
CREATE POLICY technicians_field_self_select ON public.technicians
FOR SELECT TO authenticated
USING (
  tenant_id = public.fiberos_current_tenant_id()
  AND (
    public.fiberos_field_technician_scope(id)
    OR public.fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','exec','sysadmin'])
  )
);

COMMIT;
