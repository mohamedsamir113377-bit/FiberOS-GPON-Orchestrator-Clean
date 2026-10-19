-- Migration 189: scope tenant metadata updates to the authenticated principal's tenant.
-- Role checks alone are not a tenant boundary. Both OLD-row visibility and NEW-row
-- acceptance must bind tenants.id to the trusted membership resolver.
-- Keep this policy aligned with applyPrincipal(): request.jwt.claim.sub + app_metadata.role.
-- The API uses SET LOCAL ROLE fiberos_app; keep that role in the policy target as well.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.tenants') IS NULL THEN
    RAISE EXCEPTION 'FIBERNEXUS_M189_TENANTS_TABLE_MISSING';
  END IF;
  IF to_regprocedure('public.fiberos_current_tenant_id()') IS NULL THEN
    RAISE EXCEPTION 'FIBERNEXUS_M189_TENANT_RESOLVER_MISSING';
  END IF;
  IF to_regprocedure('public.fiberos_has_any_role(text[])') IS NULL THEN
    RAISE EXCEPTION 'FIBERNEXUS_M189_ROLE_CHECK_MISSING';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tenants'
      AND policyname = 'tenants_update_management'
      AND cmd = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'FIBERNEXUS_M189_EXPECTED_POLICY_MISSING';
  END IF;
END
$preflight$;

ALTER POLICY tenants_update_management ON public.tenants
  TO fiberos_app, authenticated
  USING (
    id = public.fiberos_current_tenant_id()
    AND public.fiberos_has_any_role(
      ARRAY['ops_manager','area_supervisor','sysadmin','exec']::text[]
    )
  )
  WITH CHECK (
    id = public.fiberos_current_tenant_id()
    AND public.fiberos_has_any_role(
      ARRAY['ops_manager','area_supervisor','sysadmin','exec']::text[]
    )
  );

DO $postcondition$
DECLARE
  v_roles name[];
  v_using text;
  v_check text;
BEGIN
  SELECT roles, qual, with_check
    INTO v_roles, v_using, v_check
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'tenants'
    AND policyname = 'tenants_update_management'
    AND cmd = 'UPDATE';

  IF NOT FOUND
     OR cardinality(v_roles) <> 2
     OR NOT ('fiberos_app'::name = ANY(v_roles))
     OR NOT ('authenticated'::name = ANY(v_roles))
     OR position('fiberos_current_tenant_id' IN coalesce(v_using, '')) = 0
     OR position('fiberos_has_any_role' IN coalesce(v_using, '')) = 0
     OR position('fiberos_current_tenant_id' IN coalesce(v_check, '')) = 0
     OR position('fiberos_has_any_role' IN coalesce(v_check, '')) = 0 THEN
    RAISE EXCEPTION 'FIBERNEXUS_M189_POLICY_POSTCONDITION_FAILED';
  END IF;
END
$postcondition$;

COMMIT;
