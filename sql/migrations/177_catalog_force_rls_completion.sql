-- 177_catalog_force_rls_completion.sql
-- Runtime gate required_rls_force fails until these catalog tables have FORCE RLS.
-- Catalogs were created with grants but without ENABLE RLS. ENABLE + FORCE, then
-- open SELECT policies so constrained roles can still read global catalog rows.
BEGIN;

ALTER TABLE public.portal_plan_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_plan_catalog FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portal_plan_catalog_read ON public.portal_plan_catalog;
CREATE POLICY portal_plan_catalog_read ON public.portal_plan_catalog
  FOR SELECT TO fiberos_app, authenticated
  USING (true);

ALTER TABLE public.portal_plan_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_plan_entitlements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portal_plan_entitlements_read ON public.portal_plan_entitlements;
CREATE POLICY portal_plan_entitlements_read ON public.portal_plan_entitlements
  FOR SELECT TO fiberos_app, authenticated
  USING (true);

ALTER TABLE public.portal_usage_metric_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_usage_metric_catalog FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portal_usage_metric_catalog_read ON public.portal_usage_metric_catalog;
CREATE POLICY portal_usage_metric_catalog_read ON public.portal_usage_metric_catalog
  FOR SELECT TO fiberos_app, authenticated
  USING (true);

ALTER TABLE public.portal_work_type_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_work_type_catalog FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portal_work_type_catalog_read ON public.portal_work_type_catalog;
CREATE POLICY portal_work_type_catalog_read ON public.portal_work_type_catalog
  FOR SELECT TO fiberos_app, authenticated
  USING (true);

ALTER TABLE public.reality_source_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reality_source_catalog FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reality_source_catalog_read ON public.reality_source_catalog;
CREATE POLICY reality_source_catalog_read ON public.reality_source_catalog
  FOR SELECT TO fiberos_app, authenticated
  USING (true);

GRANT SELECT ON public.portal_plan_catalog TO fiberos_app, authenticated;
GRANT SELECT ON public.portal_plan_entitlements TO fiberos_app, authenticated;
GRANT SELECT ON public.portal_usage_metric_catalog TO fiberos_app, authenticated;
GRANT SELECT ON public.portal_work_type_catalog TO fiberos_app, authenticated;
GRANT SELECT ON public.reality_source_catalog TO fiberos_app, authenticated;

COMMIT;
