-- 161_department_scope_authority_cycle_hardening.sql
-- Defense-in-depth for the department KPI scope authority function.
-- Legacy/corrupt department graphs must not be able to make an authorization
-- CTE recurse indefinitely. Capability selection is also fixed to the shipped
-- department KPI read authority surface.
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
    JOIN hierarchy child
      ON child.parent_id = parent.id
    WHERE parent.tenant_id = fiberos_session_tenant_id()
      AND parent.active = true
      AND NOT parent.id = ANY(child.path)
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
IS 'Department KPI authority: session-derived tenant + authenticated user + active/valid enterprise position + explicit department capability grant; ancestor grants cover descendants, legacy graph cycles are traversal-bounded, and only department_kpi:read is accepted.';

COMMIT;
