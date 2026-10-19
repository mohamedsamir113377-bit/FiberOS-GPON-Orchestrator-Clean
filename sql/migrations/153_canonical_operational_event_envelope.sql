-- 153_canonical_operational_event_envelope.sql
-- Canonical metadata for the existing outbox_events fabric.
-- Does not create a second event table or claim broker/runtime delivery.
BEGIN;

ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS canonical_event_version text,
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS causation_id text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS security_classification text,
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS payload_sha256 char(64),
  ADD COLUMN IF NOT EXISTS integrity_sha256 char(64);

ALTER TABLE outbox_events
  DROP CONSTRAINT IF EXISTS outbox_canonical_event_metadata_check;

ALTER TABLE outbox_events
  ADD CONSTRAINT outbox_canonical_event_metadata_check
  CHECK (
    canonical_event_version IS NULL
    OR (
      canonical_event_version = 'fiberos.operational-event.v1'
      AND correlation_id IS NOT NULL
      AND length(btrim(correlation_id)) BETWEEN 1 AND 160
      AND idempotency_key IS NOT NULL
      AND length(btrim(idempotency_key)) BETWEEN 16 AND 160
      AND security_classification IN ('public','internal','confidential','restricted')
      AND occurred_at IS NOT NULL
      AND payload_sha256 IS NOT NULL
      AND payload_sha256 ~ '^[0-9a-fA-F]{64}$'
      AND integrity_sha256 IS NOT NULL
      AND integrity_sha256 ~ '^[0-9a-fA-F]{64}$'
    )
  );

ALTER TABLE outbox_events
  DROP CONSTRAINT IF EXISTS outbox_canonical_security_classification_check;

ALTER TABLE outbox_events
  ADD CONSTRAINT outbox_canonical_security_classification_check
  CHECK (
    security_classification IS NULL
    OR security_classification IN ('public','internal','confidential','restricted')
  );

ALTER TABLE outbox_events
  DROP CONSTRAINT IF EXISTS outbox_canonical_hash_format_check;

ALTER TABLE outbox_events
  ADD CONSTRAINT outbox_canonical_hash_format_check
  CHECK (
    (payload_sha256 IS NULL OR payload_sha256 ~ '^[0-9a-fA-F]{64}$')
    AND
    (integrity_sha256 IS NULL OR integrity_sha256 ~ '^[0-9a-fA-F]{64}$')
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_tenant_idempotency
  ON outbox_events(tenant_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outbox_tenant_correlation_time
  ON outbox_events(tenant_id,correlation_id,occurred_at DESC)
  WHERE correlation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fiberos_guard_outbox_canonical_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog,public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.event_id IS DISTINCT FROM NEW.event_id
       OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR OLD.aggregate_type IS DISTINCT FROM NEW.aggregate_type
       OR OLD.aggregate_id IS DISTINCT FROM NEW.aggregate_id
       OR OLD.event_type IS DISTINCT FROM NEW.event_type
       OR OLD.payload IS DISTINCT FROM NEW.payload
       OR OLD.canonical_event_version IS DISTINCT FROM NEW.canonical_event_version
       OR OLD.correlation_id IS DISTINCT FROM NEW.correlation_id
       OR OLD.causation_id IS DISTINCT FROM NEW.causation_id
       OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
       OR OLD.security_classification IS DISTINCT FROM NEW.security_classification
       OR OLD.occurred_at IS DISTINCT FROM NEW.occurred_at
       OR OLD.payload_sha256 IS DISTINCT FROM NEW.payload_sha256
       OR OLD.integrity_sha256 IS DISTINCT FROM NEW.integrity_sha256
    THEN
      RAISE EXCEPTION 'OUTBOX_CANONICAL_FIELDS_IMMUTABLE';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fiberos_guard_outbox_canonical_immutability() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_outbox_canonical_immutability ON outbox_events;
CREATE TRIGGER trg_outbox_canonical_immutability
BEFORE UPDATE ON outbox_events
FOR EACH ROW
EXECUTE FUNCTION public.fiberos_guard_outbox_canonical_immutability();

COMMIT;
