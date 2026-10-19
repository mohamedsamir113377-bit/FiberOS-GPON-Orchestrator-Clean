-- R14.1 P0: database firewall and role enforcement.
-- This migration adds database-owned authority and closes direct client DML
-- paths for sensitive operational state. Runtime verification remains separate.
BEGIN;

-- The repository has no contracts table in the applied schema. Existing
-- tenant-sensitive contract/processing tables are forced by their canonical
-- migrations; this migration only targets tables that actually exist here.
ALTER TABLE IF EXISTS payment_cycles FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS payment_cycle_events FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS rework_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS rework_case_events FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS tickets FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS call_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS call_queue_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS event_outbox_contract FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS event_processing_attempts FORCE ROW LEVEL SECURITY;

-- Authenticated clients must use the authority functions. Service-side
-- SECURITY DEFINER functions remain the only write path for these tables.
REVOKE ALL ON payment_cycle_events FROM PUBLIC, authenticated, fiberos_app;
REVOKE ALL ON rework_cases FROM PUBLIC, authenticated, fiberos_app;
REVOKE ALL ON rework_case_events FROM PUBLIC, authenticated, fiberos_app;
REVOKE INSERT, UPDATE, DELETE ON rework_cases FROM PUBLIC, authenticated, fiberos_app;
REVOKE INSERT, UPDATE, DELETE ON payment_cycles FROM PUBLIC, authenticated, fiberos_app;

CREATE OR REPLACE FUNCTION fiberos_session_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
set search_path = pg_catalog, public, auth
AS $$
  SELECT up.tenant_id
  FROM user_preferences up
  WHERE up.user_id = auth.uid()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION fiberos_session_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fiberos_session_tenant_id() TO authenticated;

CREATE OR REPLACE FUNCTION fiberos_rework_ticket_firewall(
  p_tenant_id uuid,
  p_ticket_id uuid
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
set search_path = pg_catalog, public, auth
AS $$
DECLARE session_tenant uuid;
BEGIN
  session_tenant := fiberos_session_tenant_id();
  IF session_tenant IS NULL OR p_tenant_id IS DISTINCT FROM session_tenant THEN
    RAISE EXCEPTION 'REWORK_TENANT_CONTEXT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF p_ticket_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM tickets t
    WHERE t.id = p_ticket_id AND t.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'REWORK_TICKET_TENANT_MISMATCH' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION fiberos_rework_ticket_firewall(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fiberos_rework_ticket_firewall(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION fiberos_rework_case_firewall_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
set search_path = pg_catalog, public, auth
AS $$
BEGIN
  PERFORM fiberos_rework_ticket_firewall(NEW.tenant_id, NEW.ticket_id);
  IF NEW.evidence_reference IS NULL OR length(trim(NEW.evidence_reference)) = 0 THEN
    RAISE EXCEPTION 'REWORK_EVIDENCE_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.case_id IS DISTINCT FROM OLD.case_id
       OR NEW.ticket_id IS DISTINCT FROM OLD.ticket_id
       OR NEW.reported_by IS DISTINCT FROM OLD.reported_by
       OR (OLD.status = 'closed' AND NEW.status <> OLD.status) THEN
      RAISE EXCEPTION 'REWORK_MUTATION_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'closed' AND (
      NEW.resolution_action IS NULL OR length(trim(NEW.resolution_action)) = 0
      OR NEW.closed_at IS NULL
    ) THEN
      RAISE EXCEPTION 'REWORK_CLOSE_INCOMPLETE' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rework_case_firewall ON rework_cases;
CREATE TRIGGER trg_rework_case_firewall
BEFORE INSERT OR UPDATE ON rework_cases
FOR EACH ROW EXECUTE FUNCTION fiberos_rework_case_firewall_trigger();

CREATE OR REPLACE FUNCTION fiberos_payment_cycle_firewall_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
set search_path = pg_catalog, public, auth
AS $$
BEGIN
  IF NEW.state = 'NOT_PROCESSED' OR NEW.state NOT IN ('submitted','approved','rejected','paid') THEN
    RAISE EXCEPTION 'PAYMENT_STATE_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = NEW.invoice_id
      AND i.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'PAYMENT_INVOICE_TENANT_MISMATCH' USING ERRCODE = '42501';
  END IF;
  IF NEW.actor_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'PAYMENT_ACTOR_MISMATCH' USING ERRCODE = '42501';
  END IF;
  IF NEW.state = 'submitted' AND NEW.rejection_reason IS NOT NULL THEN
    RAISE EXCEPTION 'PAYMENT_SUBMITTED_CANNOT_HAVE_REJECTION' USING ERRCODE = '22023';
  END IF;
  IF NEW.state = 'rejected' AND NULLIF(trim(coalesce(NEW.rejection_reason,'')), '') IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_REJECTION_REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
       OR (OLD.state = 'paid' AND NEW.state <> 'paid')
       OR (OLD.state = 'rejected' AND NEW.state <> 'rejected') THEN
      RAISE EXCEPTION 'PAYMENT_CYCLE_MUTATION_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF NOT (
      (OLD.state = 'submitted' AND NEW.state IN ('approved','rejected'))
      OR (OLD.state = 'approved' AND NEW.state = 'paid')
      OR OLD.state = NEW.state
    ) THEN
      RAISE EXCEPTION 'PAYMENT_TRANSITION_FORBIDDEN' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_cycle_firewall ON payment_cycles;
CREATE TRIGGER trg_payment_cycle_firewall
BEFORE INSERT OR UPDATE ON payment_cycles
FOR EACH ROW EXECUTE FUNCTION fiberos_payment_cycle_firewall_trigger();

CREATE OR REPLACE FUNCTION fiberos_payment_cycle_event_firewall_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
set search_path = pg_catalog, public, auth
AS $$
DECLARE cycle_tenant uuid; cycle_state text;
BEGIN
  SELECT pc.tenant_id, pc.state INTO cycle_tenant, cycle_state
  FROM payment_cycles pc
  WHERE pc.id = NEW.payment_cycle_id
  FOR SHARE;
  IF cycle_tenant IS NULL OR cycle_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'PAYMENT_EVENT_TENANT_MISMATCH' USING ERRCODE = '42501';
  END IF;
  PERFORM fiberos_session_tenant_id();
  IF fiberos_session_tenant_id() IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'PAYMENT_EVENT_SESSION_TENANT_MISMATCH' USING ERRCODE = '42501';
  END IF;
  IF NEW.to_state = 'NOT_PROCESSED' OR NEW.to_state NOT IN ('submitted','approved','rejected','paid') THEN
    RAISE EXCEPTION 'PAYMENT_EVENT_STATE_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NEW.actor_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'PAYMENT_EVENT_ACTOR_MISMATCH' USING ERRCODE = '42501';
  END IF;
  IF NEW.from_state IS NOT NULL AND NEW.from_state IS DISTINCT FROM (
     CASE WHEN NEW.to_state = 'submitted' THEN NULL ELSE
       (SELECT e.to_state
        FROM payment_cycle_events e
        WHERE e.payment_cycle_id = NEW.payment_cycle_id
          AND e.id < NEW.id
        ORDER BY e.id DESC
        LIMIT 1)
     END
  ) THEN
    RAISE EXCEPTION 'PAYMENT_EVENT_FROM_STATE_MISMATCH' USING ERRCODE = '42501';
  END IF;
  IF NEW.to_state = 'paid' AND NULLIF(trim(coalesce(NEW.evidence_reference,'')), '') IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_EVENT_EVIDENCE_REQUIRED' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_cycle_event_firewall ON payment_cycle_events;
CREATE TRIGGER trg_payment_cycle_event_firewall
BEFORE INSERT ON payment_cycle_events
FOR EACH ROW EXECUTE FUNCTION fiberos_payment_cycle_event_firewall_trigger();

CREATE OR REPLACE FUNCTION fiberos_rework_event_firewall_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
set search_path = pg_catalog, public, auth
AS $$
DECLARE case_tenant uuid; case_ticket uuid;
BEGIN
  SELECT rc.tenant_id, rc.ticket_id INTO case_tenant, case_ticket
  FROM rework_cases rc
  WHERE rc.id = NEW.rework_case_id
  FOR SHARE;
  IF case_tenant IS NULL OR case_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'REWORK_EVENT_TENANT_MISMATCH' USING ERRCODE = '42501';
  END IF;
  PERFORM fiberos_rework_ticket_firewall(case_tenant, case_ticket);
  IF NEW.actor_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'REWORK_EVENT_ACTOR_MISMATCH' USING ERRCODE = '42501';
  END IF;
  IF NEW.event_type NOT IN ('opened','closed') THEN
    RAISE EXCEPTION 'REWORK_EVENT_TYPE_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NEW.event_type = 'closed' AND (
    NULLIF(trim(coalesce(NEW.evidence_reference,'')), '') IS NULL
    OR NULLIF(trim(coalesce(NEW.resolution_action,'')), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'REWORK_EVENT_CLOSE_EVIDENCE_REQUIRED' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rework_event_firewall ON rework_case_events;
CREATE TRIGGER trg_rework_event_firewall
BEFORE INSERT ON rework_case_events
FOR EACH ROW EXECUTE FUNCTION fiberos_rework_event_firewall_trigger();

-- The legacy status sentinel is not an operational payment state and may never
-- enter persisted payment-cycle state or event history.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM payment_cycles WHERE state = 'NOT_PROCESSED') THEN
    RAISE EXCEPTION 'LEGACY_PAYMENT_STATE_PRESENT' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM payment_cycle_events WHERE to_state = 'NOT_PROCESSED') THEN
    RAISE EXCEPTION 'LEGACY_PAYMENT_EVENT_STATE_PRESENT' USING ERRCODE = '23514';
  END IF;
END;
$$;

-- Keep event histories append-only even for privileged database users.
REVOKE UPDATE, DELETE ON payment_cycle_events FROM PUBLIC;
REVOKE UPDATE, DELETE ON rework_case_events FROM PUBLIC;

COMMIT;
