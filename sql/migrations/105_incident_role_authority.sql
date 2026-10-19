-- FiberOS R14.1 — incident lifecycle role authority.
-- Root-cause fix: the API route restricted incident mutation roles, but the
-- database trigger enforced only lifecycle state. The persisted-state authority
-- therefore depended on the API path instead of enforcing the same role boundary.
--
-- This additive migration makes the database trigger authoritative for both
-- role and lifecycle transitions while preserving FORCE RLS.

BEGIN;

CREATE OR REPLACE FUNCTION fiberos_guard_incident_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := auth.jwt()->'app_metadata'->>'role';

  IF v_role IS NULL OR v_role NOT IN ('ops_manager','area_supervisor','dispatcher','sysadmin') THEN
    RAISE EXCEPTION 'INCIDENT_ROLE_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

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

DROP TRIGGER IF EXISTS trg_incident_state_authority ON incidents;
CREATE TRIGGER trg_incident_state_authority
BEFORE INSERT OR UPDATE OF state ON incidents
FOR EACH ROW
EXECUTE FUNCTION fiberos_guard_incident_transition();

REVOKE ALL
  ON FUNCTION fiberos_guard_incident_transition()
  FROM PUBLIC, anon, authenticated, fiberos_app;

COMMIT;
