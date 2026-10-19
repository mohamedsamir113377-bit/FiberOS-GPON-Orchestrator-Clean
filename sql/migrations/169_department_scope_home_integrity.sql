-- 169_department_scope_home_integrity.sql
-- Restore department-home integrity without rewriting an already deployed migration.
-- Department KPI authority requires the active principal position to have an active,
-- same-tenant home department. Scope traversal is tenant-bounded and cycle-safe.
BEGIN;

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
    SELECT ed.id, ed.parent_id, ARRAY[ed.id]::uuid[] AS path
    FROM public.enterprise_departments ed
    WHERE ed.tenant_id = fiberos_session_tenant_id()
      AND upper(ed.code) = upper(p_department_code)
      AND ed.active = true
  ),
  hierarchy AS (
    SELECT id, parent_id, path
    FROM target
    UNION ALL
    SELECT parent.id, parent.parent_id, child.path || parent.id
    FROM public.enterprise_departments parent
    JOIN hierarchy child ON child.parent_id = parent.id
    WHERE parent.tenant_id = fiberos_session_tenant_id()
      AND parent.active = true
      AND NOT parent.id = ANY(child.path)
  ),
  principal_positions AS (
    SELECT ep.id
    FROM public.enterprise_positions ep
    JOIN public.enterprise_departments home
      ON home.id = ep.department_id
     AND home.tenant_id = ep.tenant_id
     AND home.active = true
    WHERE ep.tenant_id = fiberos_session_tenant_id()
      AND ep.user_id = auth.uid()
      AND ep.active = true
      AND ep.valid_from <= now()
      AND (ep.valid_to IS NULL OR ep.valid_to > now())
  )
  SELECT
    p_capability = 'department_kpi:read'
    AND EXISTS (
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
IS 'Department KPI authority: tenant/principal derive from the database session; principal position and its home department must be active/current; the explicit department capability grant must be active/current; ancestor grants cover descendants; traversal is cycle-bounded; only department_kpi:read is accepted.';

COMMIT;
