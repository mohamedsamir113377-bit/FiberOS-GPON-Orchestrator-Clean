-- 098_incident_initial_state_authority.sql
-- Enforce valid initial incident lifecycle state at the database boundary.
-- An incident may start only as open or declared; later state changes are
-- governed atomically by migration 097.
BEGIN;

CREATE OR REPLACE FUNCTION fiberos_guard_incident_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state NOT IN ('open','declared') THEN
      RAISE EXCEPTION 'INCIDENT_INITIAL_STATE_REJECTED'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

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
BEFORE INSERT OR UPDATE OF state ON incidents
FOR EACH ROW
EXECUTE FUNCTION fiberos_guard_incident_transition();

COMMIT;
