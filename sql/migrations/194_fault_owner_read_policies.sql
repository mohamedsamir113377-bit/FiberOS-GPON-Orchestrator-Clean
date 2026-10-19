-- Migration 194: owner SELECT policies for SECURITY DEFINER tenant FK guards under FORCE RLS.
BEGIN;
GRANT SELECT ON public.fault_jobs TO fiberos_owner;
GRANT SELECT ON public.fault_events TO fiberos_owner;
GRANT SELECT ON public.fault_evidence TO fiberos_owner;
DROP POLICY IF EXISTS fault_jobs_owner_read ON public.fault_jobs;
CREATE POLICY fault_jobs_owner_read ON public.fault_jobs FOR SELECT TO fiberos_owner USING (true);
DROP POLICY IF EXISTS fault_events_owner_read ON public.fault_events;
CREATE POLICY fault_events_owner_read ON public.fault_events FOR SELECT TO fiberos_owner USING (true);
DROP POLICY IF EXISTS fault_evidence_owner_read ON public.fault_evidence;
CREATE POLICY fault_evidence_owner_read ON public.fault_evidence FOR SELECT TO fiberos_owner USING (true);
COMMIT;
