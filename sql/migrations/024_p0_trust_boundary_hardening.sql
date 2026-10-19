-- FiberOS Alpha46 — P0 trust-boundary hardening.
-- Apply after 023_p0_tenant_authority.sql.
-- No client field is accepted as authoritative for lifecycle state.
BEGIN;

-- Keep direct authenticated status mutation blocked. The authoritative path
-- is the SECURITY DEFINER lifecycle function in migration 023.
CREATE OR REPLACE FUNCTION fiberos_guard_ticket_status_change() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER set search_path=pg_catalog,public,auth AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF current_user IN ('authenticated','fiberos_app') THEN
      RAISE EXCEPTION 'TICKET_STATUS_CHANGE_REQUIRES_DB_LIFECYCLE_FUNCTION';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ticket_status_authority ON tickets;
CREATE TRIGGER trg_ticket_status_authority
BEFORE UPDATE ON tickets FOR EACH ROW
EXECUTE FUNCTION fiberos_guard_ticket_status_change();

-- Evidence provenance is explicit. Declared source labels are not treated as
-- attestation. An attested NMS value must carry a receipt, observation time,
-- source identity, and the originating device/instrument identity.
ALTER TABLE optical_measurements
  ADD COLUMN IF NOT EXISTS provenance_trust text
  NOT NULL DEFAULT 'CLIENT_DECLARED'
  CHECK (provenance_trust IN ('CLIENT_DECLARED','NMS_POLLED_UNVERIFIED','NMS_POLLED_ATTESTED','FIELD_MEASURED_UNVERIFIED','FIELD_MEASURED_ATTESTED')),
  ADD COLUMN IF NOT EXISTS source_receipt text,
  ADD COLUMN IF NOT EXISTS observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_identity text,
  ADD COLUMN IF NOT EXISTS instrument_id text,
  ADD COLUMN IF NOT EXISTS measurement_session_id text;

ALTER TABLE optical_measurements DROP CONSTRAINT IF EXISTS optical_attestation_requirements;
ALTER TABLE optical_measurements ADD CONSTRAINT optical_attestation_requirements CHECK (
  provenance_trust NOT IN ('NMS_POLLED_ATTESTED','FIELD_MEASURED_ATTESTED')
  OR (
    source_receipt IS NOT NULL
    AND observed_at IS NOT NULL
    AND source_identity IS NOT NULL
    AND instrument_id IS NOT NULL
    AND measurement_session_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_optical_measurements_source_receipt
  ON optical_measurements(source_receipt) WHERE source_receipt IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_optical_measurements_session
  ON optical_measurements(measurement_session_id) WHERE measurement_session_id IS NOT NULL;

COMMENT ON COLUMN optical_measurements.provenance_trust IS
  'Trust class only. CLIENT_DECLARED/NMS_POLLED_UNVERIFIED/FIELD_MEASURED_UNVERIFIED are not independent attestation. Attested classes require receipt, observed_at, source_identity, instrument_id and measurement_session_id.';

COMMIT;
