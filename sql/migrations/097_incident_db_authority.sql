-- 097_incident_db_authority.sql
-- Close the documented incident lifecycle trust boundary at PostgreSQL.
-- The API may request a state transition, but DB policy is authoritative for
-- the persisted incident state and incident-event actor/tenant integrity.
BEGIN;

ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents FORCE ROW LEVEL SECURITY;
ALTER TABLE incident_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_events FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fiberos_guard_incident_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
BEGIN
  IF NEW.state IS NOT DISTINCT FROM OLD.state THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.state = 'open' AND NEW.state IN ('investigating','declared'))
    OR (OLD.state = 'investigating' AND NEW.state IN ('declared','mitigating'))
    OR (OLD.state = 'declared' AND NEW.state IN ('mitigating','resolved'))
    OR (OLD.state = 'mitigating' AND NEW.state IN ('resolved'))
    OR (OLD.state = 'resolved' AND NEW.state IN ('closed'))
  ) THEN
    RAISE EXCEPTION 'INCIDENT_TRANSITION_REJECTED'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION fiberos_guard_incident_transition() OWNER TO fiberos_owner;
REVOKE ALL ON FUNCTION fiberos_guard_incident_transition() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fiberos_guard_incident_transition() TO authenticated;

DROP TRIGGER IF EXISTS trg_incident_state_authority ON incidents;
CREATE TRIGGER trg_incident_state_authority
BEFORE UPDATE OF state ON incidents
FOR EACH ROW
EXECUTE FUNCTION fiberos_guard_incident_transition();

CREATE OR REPLACE FUNCTION fiberos_guard_incident_event_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM fiberos_current_tenant_id() THEN
    RAISE EXCEPTION 'INCIDENT_EVENT_TENANT_MISMATCH'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.actor_id IS NULL OR NEW.actor_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'INCIDENT_EVENT_ACTOR_MISMATCH'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION fiberos_guard_incident_event_authority() OWNER TO fiberos_owner;
REVOKE ALL ON FUNCTION fiberos_guard_incident_event_authority() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fiberos_guard_incident_event_authority() TO authenticated;

DROP TRIGGER IF EXISTS trg_incident_event_authority ON incident_events;
CREATE TRIGGER trg_incident_event_authority
BEFORE INSERT ON incident_events
FOR EACH ROW
EXECUTE FUNCTION fiberos_guard_incident_event_authority();

COMMIT;
