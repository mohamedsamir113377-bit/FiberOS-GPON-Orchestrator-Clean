-- 110_incident_role_authority_owner_scope.sql
-- Root-cause fix for INCIDENT_ROLE_FORBIDDEN on trusted deployment sessions.
--
-- Migration 105 made the incident lifecycle trigger enforce the JWT
-- app_metadata role for EVERY session. That is correct for RLS application
-- sessions (fiberos_app / authenticated) but it also blocked the trusted
-- deployment / administrative identity (fiberos_owner, fiberos_migrator, and
-- the superuser / bypassrls bootstrapping session). Those administrative
-- connections carry no JWT claims, so the role resolved to NULL and every
-- seed or repair of an incident row failed with INCIDENT_ROLE_FORBIDDEN
-- (SQLSTATE 42501) — even a structurally valid insert.
--
-- Deployment identities are outside the RLS application threat model: they
-- already hold object-ownership / superuser authority, so a JWT-role gate on
-- them adds no security while breaking legitimate operational DDL and seeding.
--
-- This migration scopes the ROLE gate to application sessions only. The
-- lifecycle / state authority (valid initial state, legal transitions) remains
-- enforced for EVERY session, privileged or not.
BEGIN;

CREATE OR REPLACE FUNCTION fiberos_guard_incident_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_role text;
  v_session text := session_user;
  v_privileged boolean;
BEGIN
  -- SECURITY DEFINER makes current_user always fiberos_owner, so the caller
  -- identity must be read from session_user.
  SELECT (r.rolsuper OR r.rolbypassrls) INTO v_privileged
    FROM pg_roles r WHERE r.rolname = v_session;
  v_privileged := COALESCE(v_privileged, false)
    OR v_session IN ('fiberos_owner', 'fiberos_migrator');

  IF NOT v_privileged THEN
    v_role := auth.jwt()->'app_metadata'->>'role';
    IF v_role IS NULL OR v_role NOT IN ('ops_manager', 'area_supervisor', 'dispatcher', 'sysadmin') THEN
      RAISE EXCEPTION 'INCIDENT_ROLE_FORBIDDEN'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Lifecycle authority: enforced for every session, privileged or not.
  IF TG_OP = 'INSERT' THEN
    IF NEW.state NOT IN ('open', 'declared') THEN
      RAISE EXCEPTION 'INCIDENT_INITIAL_STATE_REJECTED'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.state IS NOT DISTINCT FROM OLD.state THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.state = 'open' AND NEW.state IN ('investigating', 'declared'))
    OR (OLD.state = 'investigating' AND NEW.state IN ('declared', 'mitigating'))
    OR (OLD.state = 'declared' AND NEW.state IN ('mitigating', 'resolved'))
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

CREATE OR REPLACE FUNCTION fiberos_guard_incident_event_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_session text := session_user;
  v_privileged boolean;
BEGIN
  SELECT (r.rolsuper OR r.rolbypassrls) INTO v_privileged
    FROM pg_roles r WHERE r.rolname = v_session;
  v_privileged := COALESCE(v_privileged, false)
    OR v_session IN ('fiberos_owner', 'fiberos_migrator');

  -- Only trusted deployment sessions may seed incident events without claims;
  -- application sessions must bind actor_id to the JWT identity below.
  IF v_privileged THEN
    RETURN NEW;
  END IF;

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

REVOKE ALL ON FUNCTION fiberos_guard_incident_transition() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION fiberos_guard_incident_event_authority() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fiberos_guard_incident_transition() TO authenticated;
GRANT EXECUTE ON FUNCTION fiberos_guard_incident_event_authority() TO authenticated;

DROP TRIGGER IF EXISTS trg_incident_state_authority ON incidents;
CREATE TRIGGER trg_incident_state_authority
BEFORE INSERT OR UPDATE OF state ON incidents
FOR EACH ROW
EXECUTE FUNCTION fiberos_guard_incident_transition();

DROP TRIGGER IF EXISTS trg_incident_event_authority ON incident_events;
CREATE TRIGGER trg_incident_event_authority
BEFORE INSERT ON incident_events
FOR EACH ROW
EXECUTE FUNCTION fiberos_guard_incident_event_authority();

COMMIT;
