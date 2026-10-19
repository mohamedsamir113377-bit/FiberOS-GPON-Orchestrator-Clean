-- 129_technician_current_position_authority.sql
-- Authoritative projection of the latest persisted technician position.
BEGIN;

ALTER TABLE public.technicians
  ADD COLUMN IF NOT EXISTS current_gps_captured_at timestamptz;

UPDATE public.technicians t
SET current_gps = p.position,
    current_gps_captured_at = p.captured_at,
    updated_at = now()
FROM (
  SELECT DISTINCT ON (p.technician_id, p.tenant_id)
         p.technician_id, p.tenant_id, p.position, p.captured_at
  FROM public.technician_positions p
  ORDER BY p.technician_id, p.tenant_id, p.captured_at DESC, p.id DESC
) p
WHERE p.technician_id = t.id
  AND p.tenant_id = t.tenant_id
  AND p.position IS NOT NULL
  AND (t.current_gps_captured_at IS NULL OR p.captured_at >= t.current_gps_captured_at);

CREATE OR REPLACE FUNCTION public.fiberos_project_current_technician_position()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
BEGIN
  UPDATE public.technicians t
  SET current_gps = NEW.position,
      current_gps_captured_at = NEW.captured_at,
      updated_at = now()
  WHERE NEW.position IS NOT NULL
    AND t.id = NEW.technician_id
    AND t.tenant_id = NEW.tenant_id
    AND (t.current_gps_captured_at IS NULL OR NEW.captured_at >= t.current_gps_captured_at);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fiberos_project_current_technician_position() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_technician_position_project_current ON public.technician_positions;
CREATE TRIGGER trg_technician_position_project_current
AFTER INSERT ON public.technician_positions
FOR EACH ROW
EXECUTE FUNCTION public.fiberos_project_current_technician_position();

COMMIT;
