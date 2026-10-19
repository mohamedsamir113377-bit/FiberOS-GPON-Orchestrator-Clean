-- 134_fault_root_asset_link.sql
-- Optional, operator-selected root network asset for outage impact tracing.
-- No spatial guess is performed when this is null.
BEGIN;

ALTER TABLE public.fault_jobs
  ADD COLUMN IF NOT EXISTS root_asset_id uuid;

CREATE INDEX IF NOT EXISTS idx_fault_jobs_root_asset
  ON public.fault_jobs(tenant_id,root_asset_id)
  WHERE root_asset_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.fault_jobs'::regclass
      AND conname='fault_jobs_root_asset_id_fkey'
  ) THEN
    ALTER TABLE public.fault_jobs
      ADD CONSTRAINT fault_jobs_root_asset_id_fkey
      FOREIGN KEY (root_asset_id) REFERENCES public.network_assets(id) ON DELETE SET NULL;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_fault_root_asset_tenant ON public.fault_jobs;
CREATE TRIGGER trg_fault_root_asset_tenant
BEFORE INSERT OR UPDATE OF root_asset_id,tenant_id
ON public.fault_jobs
FOR EACH ROW
WHEN (NEW.root_asset_id IS NOT NULL)
EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('network_assets','id','root_asset_id');

COMMIT;
