-- 160_department_scope_authority.sql
-- Explicit department scope authority for management KPI reads.
-- Database session identity remains authoritative for tenant and principal.
BEGIN;

ALTER TABLE public.enterprise_scope_grants
  DROP CONSTRAINT IF EXISTS enterprise_scope_grants_scope_type_check;

ALTER TABLE public.enterprise_scope_grants
  ADD CONSTRAINT enterprise_scope_grants_scope_type_check
  CHECK (scope_type IN (
    'enterprise','sector','region','central','team','department',
    'work_package','contractor','warehouse','network_area'
  ));

CREATE INDEX IF NOT EXISTS idx_enterprise_scope_department_read
  ON public.enterprise_scope_grants(tenant_id,position_id,scope_type,scope_id)
  WHERE scope_type='department';

CREATE OR REPLACE FUNCTION public.fiberos_enterprise_department_scope_allowed(
  p_department_code text,
  p_capability text DEFAULT 'department_kpi:read'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
  WITH RECURSIVE
  target AS (
    SELECT ed.id, ed.parent_id
    FROM public.enterprise_departments ed
    WHERE ed.tenant_id = fiberos_session_tenant_id()
      AND upper(ed.code) = upper(p_department_code)
      AND ed.active = true
  ),
  hierarchy AS (
    SELECT id, parent_id FROM target
    UNION ALL
    SELECT parent.id, parent.parent_id
    FROM public.enterprise_departments parent
    JOIN hierarchy child ON child.parent_id = parent.id
    WHERE parent.tenant_id = fiberos_session_tenant_id()
      AND parent.active = true
  ),
  principal_positions AS (
    SELECT ep.id
    FROM public.enterprise_positions ep
    WHERE ep.tenant_id = fiberos_session_tenant_id()
      AND ep.user_id = auth.uid()
      AND ep.active = true
      AND ep.valid_from <= now()
      AND (ep.valid_to IS NULL OR ep.valid_to > now())
  )
  SELECT EXISTS (
    SELECT 1
    FROM principal_positions pp
    JOIN public.enterprise_scope_grants sg
      ON sg.tenant_id = fiberos_session_tenant_id()
     AND sg.position_id = pp.id
     AND sg.scope_type = 'department'
     AND sg.scope_id IN (SELECT id FROM hierarchy)
     AND p_capability = ANY(sg.capabilities)
     AND sg.valid_from <= now()
     AND (sg.valid_to IS NULL OR sg.valid_to > now())
  )
$$;

REVOKE ALL ON FUNCTION public.fiberos_enterprise_department_scope_allowed(text,text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fiberos_enterprise_department_scope_allowed(text,text)
  TO fiberos_app;

COMMENT ON FUNCTION public.fiberos_enterprise_department_scope_allowed(text,text)
IS 'Explicit department scope authority: database-session principal + active position + valid department grant + capability; ancestor grants cover descendants only.';

COMMIT;
