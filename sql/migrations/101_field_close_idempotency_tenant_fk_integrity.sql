-- 101_field_close_idempotency_tenant_fk_integrity.sql
-- Close the adversarially proven tenant-boundary gap for field-close idempotency.
-- Migration 099 and 100 remain immutable.
BEGIN;

CREATE OR REPLACE FUNCTION fiberos_enforce_field_close_idempotency_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, auth
AS $$
BEGIN
  IF NEW.ticket_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM tickets t
    WHERE t.id = NEW.ticket_id
      AND t.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'TENANT_MISMATCH_FIELD_CLOSE_TICKET'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION fiberos_enforce_field_close_idempotency_tenant_consistency()
  OWNER TO fiberos_owner;

DROP TRIGGER IF EXISTS trg_field_close_idempotency_tenant_consistency
  ON field_close_idempotency;

CREATE TRIGGER trg_field_close_idempotency_tenant_consistency
BEFORE INSERT OR UPDATE OF ticket_id, tenant_id
ON field_close_idempotency
FOR EACH ROW
EXECUTE FUNCTION fiberos_enforce_field_close_idempotency_tenant_consistency();

REVOKE ALL ON FUNCTION fiberos_enforce_field_close_idempotency_tenant_consistency()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fiberos_enforce_field_close_idempotency_tenant_consistency()
  TO authenticated;

COMMIT;
