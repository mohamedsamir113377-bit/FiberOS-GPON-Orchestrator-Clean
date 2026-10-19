-- FiberOS R14.1 — root tenant-consistency closure for field-close references.
-- Root-cause fixes:
-- 1) tickets.close_measurement_id is a single-column FK and previously did not
--    prove that the referenced optical_measurements row belongs to the same tenant.
-- 2) outbox_events.aggregate_id is polymorphic text, so the generic outbox table
--    cannot use a normal FK to prove that a ticket aggregate belongs to the
--    event tenant. For ticket aggregates, the DB must enforce that relation.
--
-- RLS remains the primary visibility boundary; these triggers make the
-- cross-tenant relationships fail closed even when a caller knows another
-- tenant's UUID/ID.

BEGIN;

CREATE OR REPLACE FUNCTION fiberos_enforce_ticket_close_measurement_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, auth
AS $$
BEGIN
  IF NEW.close_measurement_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM optical_measurements m
     WHERE m.id = NEW.close_measurement_id
       AND m.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'TENANT_MISMATCH_TICKET_CLOSE_MEASUREMENT'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION fiberos_enforce_ticket_close_measurement_tenant_consistency()
  OWNER TO fiberos_owner;

DROP TRIGGER IF EXISTS trg_ticket_close_measurement_tenant_consistency
  ON tickets;
CREATE TRIGGER trg_ticket_close_measurement_tenant_consistency
BEFORE INSERT OR UPDATE OF close_measurement_id, tenant_id
ON tickets
FOR EACH ROW
EXECUTE FUNCTION fiberos_enforce_ticket_close_measurement_tenant_consistency();

REVOKE ALL
  ON FUNCTION fiberos_enforce_ticket_close_measurement_tenant_consistency()
  FROM PUBLIC, anon, authenticated, fiberos_app;

CREATE OR REPLACE FUNCTION fiberos_enforce_outbox_ticket_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, auth
AS $$
BEGIN
  IF NEW.aggregate_type = 'ticket' THEN
    IF NEW.aggregate_id IS NULL OR NOT EXISTS (
      SELECT 1
        FROM tickets t
       WHERE t.id = NEW.aggregate_id::uuid
         AND t.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'TENANT_MISMATCH_OUTBOX_TICKET'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION
  WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'OUTBOX_TICKET_AGGREGATE_ID_INVALID'
      USING ERRCODE = '22P02';
END;
$$;

ALTER FUNCTION fiberos_enforce_outbox_ticket_tenant_consistency()
  OWNER TO fiberos_owner;

DROP TRIGGER IF EXISTS trg_outbox_ticket_tenant_consistency
  ON outbox_events;
CREATE TRIGGER trg_outbox_ticket_tenant_consistency
BEFORE INSERT OR UPDATE OF aggregate_type, aggregate_id, tenant_id
ON outbox_events
FOR EACH ROW
EXECUTE FUNCTION fiberos_enforce_outbox_ticket_tenant_consistency();

REVOKE ALL
  ON FUNCTION fiberos_enforce_outbox_ticket_tenant_consistency()
  FROM PUBLIC, anon, authenticated, fiberos_app;

COMMENT ON FUNCTION fiberos_enforce_ticket_close_measurement_tenant_consistency()
IS 'Fail-closed tenant binding for tickets.close_measurement_id to optical_measurements.';
COMMENT ON FUNCTION fiberos_enforce_outbox_ticket_tenant_consistency()
IS 'Fail-closed tenant binding for ticket aggregate outbox events.';

COMMIT;
