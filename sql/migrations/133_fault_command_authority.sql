-- 133_fault_command_authority.sql
-- Database-authoritative safety rails for fault public tracking and resolution.
-- No provider delivery, storage verification, GPS or optical value is created here.
BEGIN;

-- Public fault tracking runs as fiberos_app. The RLS policy from migration 132
-- narrows visibility to an unexpired, non-revoked tracking token.
GRANT SELECT ON public.fault_jobs TO fiberos_app;

-- The SECURITY DEFINER command guard needs to inspect evidence under FORCE RLS.
DROP POLICY IF EXISTS fault_evidence_guard_owner_select ON public.fault_evidence;
CREATE POLICY fault_evidence_guard_owner_select
  ON public.fault_evidence
  FOR SELECT
  TO fiberos_owner
  USING (true);

CREATE OR REPLACE FUNCTION public.fiberos_fault_command_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  has_fault_photo boolean;
  has_optical_power boolean;
BEGIN
  IF NEW.status = 'SCHEDULED' THEN
    IF NEW.call_center_verified IS NOT TRUE THEN
      RAISE EXCEPTION 'FAULT_CALL_CENTER_VERIFICATION_REQUIRED' USING ERRCODE='42501';
    END IF;
    IF NEW.visit_scheduled_at IS NULL THEN
      RAISE EXCEPTION 'FAULT_VISIT_TIME_REQUIRED' USING ERRCODE='22023';
    END IF;
  ELSIF NEW.status = 'DISPATCHED' THEN
    IF NEW.technician_id IS NULL THEN
      RAISE EXCEPTION 'FAULT_TECHNICIAN_REQUIRED' USING ERRCODE='22023';
    END IF;
  ELSIF NEW.status = 'TECHNICIAN_ACCEPTED' THEN
    IF NEW.technician_id IS NULL OR NEW.technician_accepted_at IS NULL THEN
      RAISE EXCEPTION 'FAULT_TECHNICIAN_ACCEPTANCE_REQUIRED' USING ERRCODE='22023';
    END IF;
  ELSIF NEW.status = 'IN_PROGRESS' THEN
    IF NEW.technician_id IS NULL OR NEW.started_at IS NULL THEN
      RAISE EXCEPTION 'FAULT_WORK_START_REQUIRED' USING ERRCODE='22023';
    END IF;
  ELSIF NEW.status = 'RESOLVED' THEN
    IF NEW.customer_acceptance IS NOT TRUE THEN
      RAISE EXCEPTION 'FAULT_CUSTOMER_ACCEPTANCE_REQUIRED' USING ERRCODE='42501';
    END IF;
    IF NEW.resolved_at IS NULL THEN
      RAISE EXCEPTION 'FAULT_RESOLUTION_TIMESTAMP_REQUIRED' USING ERRCODE='22023';
    END IF;

    SELECT
      EXISTS (
        SELECT 1
        FROM public.fault_evidence e
        WHERE e.fault_job_id = NEW.id
          AND e.evidence_type = 'FAULT_PHOTO'
          AND e.storage_status = 'STORAGE_VERIFIED'
      ),
      EXISTS (
        SELECT 1
        FROM public.fault_evidence e
        WHERE e.fault_job_id = NEW.id
          AND e.evidence_type = 'OPTICAL_POWER'
          AND e.storage_status = 'STORAGE_VERIFIED'
      )
    INTO has_fault_photo, has_optical_power;

    IF NOT has_fault_photo THEN
      RAISE EXCEPTION 'FAULT_PHOTO_EVIDENCE_REQUIRED' USING ERRCODE='42501';
    END IF;

    IF NEW.fault_type IN ('OPTICAL_LOSS','NO_SYNC','DROP_DAMAGE','INTERMITTENT')
       AND NOT has_optical_power THEN
      RAISE EXCEPTION 'FAULT_OPTICAL_EVIDENCE_REQUIRED' USING ERRCODE='42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fiberos_fault_command_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_fault_command_guard ON public.fault_jobs;
CREATE TRIGGER trg_fault_command_guard
BEFORE INSERT OR UPDATE ON public.fault_jobs
FOR EACH ROW
EXECUTE FUNCTION public.fiberos_fault_command_guard();

-- Public tokenized tracking must never expose revoked or expired links.
DROP POLICY IF EXISTS fault_jobs_public_tracking_select ON public.fault_jobs;
CREATE POLICY fault_jobs_public_tracking_select ON public.fault_jobs
  FOR SELECT
  TO fiberos_app
  USING (
    customer_tracking_token_hash IS NOT NULL
    AND length(nullif(current_setting('fiberos.public_tracking_token_hash', true), '')) = 64
    AND customer_tracking_token_hash = current_setting('fiberos.public_tracking_token_hash', true)
    AND customer_tracking_revoked = false
    AND customer_tracking_expires_at IS NOT NULL
    AND customer_tracking_expires_at > now()
  );


DROP POLICY IF EXISTS technicians_public_fault_tracking_select ON public.technicians;
CREATE POLICY technicians_public_fault_tracking_select
  ON public.technicians
  FOR SELECT
  TO fiberos_app
  USING (
    EXISTS (
      SELECT 1 FROM public.fault_jobs f
      WHERE f.technician_id = technicians.id
        AND f.customer_tracking_token_hash IS NOT NULL
        AND length(nullif(current_setting('fiberos.public_tracking_token_hash', true), '')) = 64
        AND f.customer_tracking_token_hash = current_setting('fiberos.public_tracking_token_hash', true)
        AND f.customer_tracking_revoked = false
        AND f.customer_tracking_expires_at > now()
    )
  );

DROP POLICY IF EXISTS technician_positions_public_fault_tracking_select ON public.technician_positions;
CREATE POLICY technician_positions_public_fault_tracking_select
  ON public.technician_positions
  FOR SELECT
  TO fiberos_app
  USING (
    EXISTS (
      SELECT 1 FROM public.fault_jobs f
      WHERE f.technician_id = technician_positions.technician_id
        AND f.tenant_id = technician_positions.tenant_id
        AND f.customer_tracking_token_hash IS NOT NULL
        AND length(nullif(current_setting('fiberos.public_tracking_token_hash', true), '')) = 64
        AND f.customer_tracking_token_hash = current_setting('fiberos.public_tracking_token_hash', true)
        AND f.customer_tracking_revoked = false
        AND f.customer_tracking_expires_at > now()
    )
  );

-- Explicit provider-side verification boundary for evidence metadata.
-- The application may record hashes/references but cannot self-upgrade them
-- to provider-verified status.
CREATE OR REPLACE FUNCTION public.fiberos_fault_evidence_verification_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
BEGIN
  IF NEW.storage_status = 'STORAGE_VERIFIED'
     AND current_setting('fiberos.evidence_provider_verified', true) <> '1' THEN
    RAISE EXCEPTION 'FAULT_EVIDENCE_PROVIDER_VERIFICATION_REQUIRED' USING ERRCODE='42501';
  END IF;

  IF NEW.storage_status = 'STORAGE_VERIFIED'
     AND (NEW.provider_verified_sha256 IS NULL
          OR NEW.provider_verified_sha256 <> NEW.content_sha256) THEN
    RAISE EXCEPTION 'FAULT_EVIDENCE_VERIFIED_HASH_MISMATCH' USING ERRCODE='22023';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fiberos_fault_evidence_verification_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_fault_evidence_verification_guard ON public.fault_evidence;
CREATE TRIGGER trg_fault_evidence_verification_guard
BEFORE INSERT OR UPDATE ON public.fault_evidence
FOR EACH ROW
EXECUTE FUNCTION public.fiberos_fault_evidence_verification_guard();

COMMIT;
