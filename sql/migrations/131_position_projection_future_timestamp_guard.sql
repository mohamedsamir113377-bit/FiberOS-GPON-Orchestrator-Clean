-- 131_position_projection_future_timestamp_guard.sql
-- Reject future technician position timestamps before they can affect current projections.
-- A two-minute tolerance is allowed for ordinary device clock skew.
BEGIN;

CREATE OR REPLACE FUNCTION public.fiberos_position_timestamp_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
BEGIN
  IF NEW.captured_at > (now() + interval '2 minutes') THEN
    RAISE EXCEPTION 'TECHNICIAN_POSITION_FUTURE_TIMESTAMP_REJECTED' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fiberos_position_timestamp_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_technician_position_future_timestamp_guard ON public.technician_positions;
CREATE TRIGGER trg_technician_position_future_timestamp_guard
BEFORE INSERT OR UPDATE OF captured_at
ON public.technician_positions
FOR EACH ROW
EXECUTE FUNCTION public.fiberos_position_timestamp_guard();

COMMIT;
