-- 135_current_technician_gis_view.sql
-- Live GIS projection: one latest persisted technician position per active technician.
-- Security-invoker keeps underlying table permissions and RLS of the calling DB role.
BEGIN;

CREATE INDEX IF NOT EXISTS idx_technician_positions_tenant_tech_captured_id
  ON public.technician_positions (tenant_id, technician_id, captured_at DESC, id DESC)
  WHERE position IS NOT NULL;

DROP VIEW IF EXISTS public.fiberos_current_technician_gis;

CREATE VIEW public.fiberos_current_technician_gis
WITH (security_invoker = true)
AS
SELECT
  t.id,
  t.tenant_id,
  t.name,
  t.zone,
  t.skills,
  t.battery_status,
  t.is_active,
  p.captured_at,
  p.accuracy_meters,
  p.altitude_meters,
  p.heading_degrees,
  p.speed_mps,
  p.source,
  p.position
FROM public.technicians t
JOIN LATERAL (
  SELECT
    p.captured_at,
    p.accuracy_meters,
    p.altitude_meters,
    p.heading_degrees,
    p.speed_mps,
    p.source,
    p.position
  FROM public.technician_positions p
  WHERE p.technician_id = t.id
    AND p.tenant_id = t.tenant_id
    AND p.position IS NOT NULL
  ORDER BY p.captured_at DESC, p.id DESC
  LIMIT 1
) p ON true
WHERE t.is_active = true;

GRANT SELECT ON public.fiberos_current_technician_gis TO authenticated;
GRANT SELECT ON public.fiberos_current_technician_gis TO fiberos_app;

COMMIT;
