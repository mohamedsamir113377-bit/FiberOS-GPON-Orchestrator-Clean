-- FiberOS R14.1 — incident guard: restore the trusted administrative path.
-- Root cause: migration 105 made fiberos_guard_incident_transition() authoritative
-- for the JWT application role, but read that role from auth.jwt() alone. The
-- trusted administrative/bootstrap path (schema owner / cluster superuser) seeds
-- and repairs reference data on a connection that carries no application JWT
-- claims, so auth.jwt()->'app_metadata'->>'role' is NULL there and every
-- administrative incident write was rejected with INCIDENT_ROLE_FORBIDDEN.
--
-- Application runtimes connect as fiberos_runtime, which is NOT a member of
-- fiberos_owner, so exempting the owner path does NOT widen the application-facing
-- authorization boundary: an application session with a missing or unauthorized
-- role is still rejected, and the lifecycle state-machine guard is unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION fiberos_guard_incident_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_role text;
  v_trusted_admin boolean;
BEGIN
  v_trusted_admin := pg_has_role(session_user, 'fiberos_owner', 'member');

  IF NOT v_trusted_admin THEN
    v_role := auth.jwt()->'app_metadata'->>'role';
    IF v_role IS NULL OR v_role NOT IN ('ops_manager','area_supervisor','dispatcher','sysadmin') THEN
      RAISE EXCEPTION 'INCIDENT_ROLE_FORBIDDEN'
        USING ERRCODE = '42501';
    END IF;
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
