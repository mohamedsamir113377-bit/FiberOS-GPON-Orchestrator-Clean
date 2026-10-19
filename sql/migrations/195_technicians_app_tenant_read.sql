-- Migration 195: fiberos_app SELECT technicians for fault dispatch candidate query.
BEGIN;
GRANT SELECT ON public.technicians TO fiberos_app;
DROP POLICY IF EXISTS technicians_app_tenant_read ON public.technicians;
CREATE POLICY technicians_app_tenant_read ON public.technicians
FOR SELECT TO fiberos_app
USING (public.fiberos_enterprise_tenant_ok(tenant_id));
COMMIT;
