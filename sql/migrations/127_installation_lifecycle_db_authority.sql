-- 127_installation_lifecycle_db_authority.sql
-- Enforce installation state transitions and SECURITY DEFINER router-detail visibility.
-- The API remains the primary command surface, but direct DML cannot bypass the
-- canonical lifecycle graph or make the router verification guard blind under FORCE RLS.
BEGIN;

-- The trigger function is owned by fiberos_owner. Grant it SELECT-only visibility
-- to the router detail rows it must reconcile. fiberos_owner is NOLOGIN/NOSUPERUSER,
-- so this does not create an application/runtime login path.
DROP POLICY IF EXISTS router_installation_details_guard_owner_select ON router_installation_details;
CREATE POLICY router_installation_details_guard_owner_select
  ON router_installation_details
  FOR SELECT
  TO fiberos_owner
  USING (true);

CREATE OR REPLACE FUNCTION fiberos_installation_lifecycle_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' OR NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'INTAKE' AND NEW.status IN ('CALL_CENTER_REVIEW','REJECTED','CANCELLED','SLA_BREACHED') THEN
    RETURN NEW;
  ELSIF OLD.status = 'CALL_CENTER_REVIEW' AND NEW.status IN ('SCHEDULED','REJECTED','CANCELLED','SLA_BREACHED') THEN
    RETURN NEW;
  ELSIF OLD.status = 'SCHEDULED' AND NEW.status IN ('DISPATCHED','REJECTED','CANCELLED','SLA_BREACHED') THEN
    RETURN NEW;
  ELSIF OLD.status = 'DISPATCHED' AND NEW.status IN ('TECHNICIAN_ACCEPTED','REJECTED','CANCELLED','SLA_BREACHED') THEN
    RETURN NEW;
  ELSIF OLD.status = 'TECHNICIAN_ACCEPTED' AND NEW.status IN ('IN_PROGRESS','REJECTED','CANCELLED','SLA_BREACHED') THEN
    RETURN NEW;
  ELSIF OLD.status = 'IN_PROGRESS' AND NEW.status IN ('AWAITING_CUSTOMER_CONFIRMATION','REJECTED','CANCELLED','SLA_BREACHED') THEN
    RETURN NEW;
  ELSIF OLD.status = 'AWAITING_CUSTOMER_CONFIRMATION' AND NEW.status IN ('COMPLETED','REJECTED','CANCELLED','SLA_BREACHED') THEN
    RETURN NEW;
  ELSIF OLD.status = 'SLA_BREACHED' AND NEW.status IN ('REJECTED','CANCELLED') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'INSTALLATION_INVALID_STATE_TRANSITION: % -> %', OLD.status, NEW.status
    USING ERRCODE='22023';
END;
$$;

REVOKE ALL ON FUNCTION public.fiberos_installation_lifecycle_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_installation_lifecycle_guard ON installation_jobs;
CREATE TRIGGER trg_installation_lifecycle_guard
BEFORE UPDATE OF status ON installation_jobs
FOR EACH ROW EXECUTE FUNCTION public.fiberos_installation_lifecycle_guard();

COMMIT;
