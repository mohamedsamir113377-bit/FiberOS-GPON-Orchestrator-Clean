-- 158_department_kpi_enterprise_scope.sql
-- Allows the constrained API role to read only tenant-scoped enterprise
-- structure for authorization and reporting. No organization data is inferred.
BEGIN;

GRANT EXECUTE ON FUNCTION public.fiberos_enterprise_tenant_ok(uuid)
  TO fiberos_app;

GRANT SELECT ON public.enterprise_departments,
                public.enterprise_positions,
                public.enterprise_scope_grants
  TO fiberos_app;

DROP POLICY IF EXISTS enterprise_departments_app_scope_read
  ON public.enterprise_departments;
CREATE POLICY enterprise_departments_app_scope_read
  ON public.enterprise_departments
  FOR SELECT TO fiberos_app
  USING (public.fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS enterprise_positions_app_scope_read
  ON public.enterprise_positions;
CREATE POLICY enterprise_positions_app_scope_read
  ON public.enterprise_positions
  FOR SELECT TO fiberos_app
  USING (public.fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS enterprise_scope_grants_app_scope_read
  ON public.enterprise_scope_grants;
CREATE POLICY enterprise_scope_grants_app_scope_read
  ON public.enterprise_scope_grants
  FOR SELECT TO fiberos_app
  USING (public.fiberos_enterprise_tenant_ok(tenant_id));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.enterprise_departments,
     public.enterprise_positions,
     public.enterprise_scope_grants
  FROM fiberos_app;

COMMENT ON POLICY enterprise_departments_app_scope_read
  ON public.enterprise_departments IS
  'API role may read organization units only inside the tenant derived from the verified principal.';
COMMENT ON POLICY enterprise_positions_app_scope_read
  ON public.enterprise_positions IS
  'API role may read tenant positions for explicit department-scope decisions; no DML is granted.';
COMMENT ON POLICY enterprise_scope_grants_app_scope_read
  ON public.enterprise_scope_grants IS
  'API role may read tenant scope grants; no DML is granted.';

COMMIT;
