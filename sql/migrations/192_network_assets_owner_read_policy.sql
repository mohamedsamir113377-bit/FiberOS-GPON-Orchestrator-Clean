-- Migration 192: network_assets SELECT path for fiberos_owner under FORCE RLS.
-- Symptom: TENANT_REFERENCE_MISSING_OR_NOT_VISIBLE_NETWORK_ASSETS_PARENT_ASSET_ID
-- when parent rows are invisible to the role executing fiberos_guard_fk_tenant_match
-- (SECURITY INVOKER) or to owner-owned integrity helpers under FORCE RLS.
BEGIN;

GRANT SELECT ON public.network_assets TO fiberos_owner;

DROP POLICY IF EXISTS network_assets_owner_read ON public.network_assets;
CREATE POLICY network_assets_owner_read
ON public.network_assets
FOR SELECT
TO fiberos_owner
USING (
  tenant_id = public.fiberos_current_tenant_id()
  OR public.fiberos_current_tenant_id() IS NULL
);

-- Keep application read boundary explicit (idempotent re-assert).
DROP POLICY IF EXISTS network_assets_app_read ON public.network_assets;
CREATE POLICY network_assets_app_read
ON public.network_assets
FOR SELECT
TO fiberos_app
USING (public.fiberos_enterprise_tenant_ok(tenant_id));

DO $post$
DECLARE
  v_owner boolean;
  v_app boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='network_assets'
      AND policyname='network_assets_owner_read' AND cmd='SELECT'
  ) INTO v_owner;
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='network_assets'
      AND policyname='network_assets_app_read' AND cmd='SELECT'
  ) INTO v_app;
  IF NOT v_owner OR NOT v_app THEN
    RAISE EXCEPTION 'FIBERNEXUS_M192_NETWORK_ASSETS_POLICY_POSTCONDITION_FAILED';
  END IF;
END
$post$;

COMMIT;
