-- 126_installation_evidence_integrity_and_acceptance.sql
-- Evidence storage status + customer acceptance distinct from rating.
-- Privilege closure for installation SECURITY DEFINER guard.
BEGIN;

ALTER TABLE installation_jobs
  ADD COLUMN IF NOT EXISTS customer_acceptance boolean NOT NULL DEFAULT false;

ALTER TABLE installation_jobs
  ADD COLUMN IF NOT EXISTS customer_feedback text;

ALTER TABLE installation_jobs
  ADD COLUMN IF NOT EXISTS acceptance_verification_method text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'installation_jobs_acceptance_verification_method_check'
  ) THEN
    ALTER TABLE installation_jobs
      ADD CONSTRAINT installation_jobs_acceptance_verification_method_check
      CHECK (
        acceptance_verification_method IS NULL
        OR acceptance_verification_method IN (
          'CALL_CENTER_OPERATOR_CONFIRMED',
          'CUSTOMER_PORTAL_CONFIRMED',
          'OTP_VERIFIED',
          'PROVIDER_VERIFIED',
          'UNVERIFIED_OPERATOR_ATTESTATION'
        )
      );
  END IF;
END $$;

ALTER TABLE installation_evidence
  ADD COLUMN IF NOT EXISTS storage_status text NOT NULL DEFAULT 'CLIENT_HASH_ONLY';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'installation_evidence_storage_status_check'
  ) THEN
    ALTER TABLE installation_evidence
      ADD CONSTRAINT installation_evidence_storage_status_check
      CHECK (storage_status IN (
        'CLIENT_HASH_ONLY',
        'STORAGE_UNVERIFIED',
        'STORAGE_VERIFIED',
        'HASH_MISMATCH',
        'STORAGE_MISSING'
      ));
  END IF;
END $$;

ALTER TABLE installation_evidence
  ADD COLUMN IF NOT EXISTS provider_verified_sha256 char(64);

ALTER TABLE installation_evidence
  ADD COLUMN IF NOT EXISTS provider_verified_at timestamptz;

-- SECURITY DEFINER: revoke default PUBLIC execute
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fiberos_installation_job_guard'
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.fiberos_installation_job_guard() FROM PUBLIC';
    -- Trigger owner/runtime still executes as definer; no broad EXECUTE grant required for triggers.
  END IF;
END $$;

COMMIT;
