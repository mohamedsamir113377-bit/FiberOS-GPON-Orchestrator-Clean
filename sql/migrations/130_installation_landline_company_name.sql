-- 130_installation_landline_company_name.sql
-- Explicit landline carrier/company field for installation command workflows.
BEGIN;

ALTER TABLE public.installation_jobs
  ADD COLUMN IF NOT EXISTS landline_company_name text;

COMMENT ON COLUMN public.installation_jobs.landline_company_name
  IS 'Customer landline company/carrier supplied and verified by the command workflow; nullable when not provided.';

COMMIT;
