-- 174_fiberos_current_tenant_id_security_definer.sql
-- Ensure tenant resolution helpers remain readable under FORCE RLS when the
-- session role is fiberos_app (invoker cannot always see user_preferences rows).
BEGIN;

CREATE OR REPLACE FUNCTION public.fiberos_current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
  SELECT up.tenant_id
  FROM public.user_preferences up
  WHERE up.user_id = auth.uid()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.fiberos_current_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fiberos_current_tenant_id()
  TO fiberos_app, fiberos_runtime, fiberos_worker, authenticated, anon;

COMMIT;
