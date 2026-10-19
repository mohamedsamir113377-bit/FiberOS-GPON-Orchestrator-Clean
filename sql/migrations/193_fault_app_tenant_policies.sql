-- Migration 193: fault_jobs / fault_events app-tenant policies under FORCE RLS.
-- Production received an equivalent policy set on 2026-10-18; this file is the
-- source-of-truth reconstruction so GitHub and the Neon ledger stay aligned.
BEGIN;

GRANT SELECT, INSERT, UPDATE ON public.fault_jobs TO fiberos_app;
GRANT SELECT, INSERT ON public.fault_events TO fiberos_app;

DROP POLICY IF EXISTS fault_jobs_app_tenant ON public.fault_jobs;
CREATE POLICY fault_jobs_app_tenant
ON public.fault_jobs
FOR ALL
TO fiberos_app
USING (public.fiberos_enterprise_tenant_ok(tenant_id))
WITH CHECK (public.fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS fault_events_app_tenant ON public.fault_events;
CREATE POLICY fault_events_app_tenant
ON public.fault_events
FOR ALL
TO fiberos_app
USING (public.fiberos_enterprise_tenant_ok(tenant_id))
WITH CHECK (public.fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS fault_evidence_guard_owner_select ON public.fault_evidence;
CREATE POLICY fault_evidence_guard_owner_select
ON public.fault_evidence
FOR SELECT
TO fiberos_owner
USING (true);

DO $post$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='fault_jobs' AND policyname='fault_jobs_app_tenant'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='fault_events' AND policyname='fault_events_app_tenant'
  ) THEN
    RAISE EXCEPTION 'FIBERNEXUS_M193_FAULT_APP_POLICY_POSTCONDITION_FAILED';
  END IF;
END
$post$;

COMMIT;
