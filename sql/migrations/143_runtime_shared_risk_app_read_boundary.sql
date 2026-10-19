-- 143_runtime_shared_risk_app_read_boundary.sql
-- Closes an exact runtime authorization gap found by release forensics:
-- withPrincipal() executes application queries as fiberos_app, while several
-- tenant RLS policies were originally declared only for authenticated.
-- This migration grants only the SELECT surface required by the linked
-- shared-risk analysis and keeps DML denied for the PON staging boundary.

BEGIN;

-- The predicate is SECURITY DEFINER and does not expose tenant authority;
-- fiberos_app must be able to invoke it while evaluating its tenant policy.
GRANT EXECUTE ON FUNCTION public.fiberos_enterprise_tenant_ok(uuid) TO fiberos_app;

-- Linked shared-risk analysis is read-only. Grant the smallest object surface
-- required by its SQL loader and attach tenant-scoped SELECT policies to the
-- actual application database role used by withPrincipal().
GRANT SELECT ON public.network_service_path_versions TO fiberos_app;
GRANT SELECT ON public.network_service_path_hops TO fiberos_app;
GRANT SELECT ON public.network_failure_domains TO fiberos_app;
GRANT SELECT ON public.network_failure_domain_members TO fiberos_app;
GRANT SELECT ON public.network_assets TO fiberos_app;
GRANT SELECT ON public.services TO fiberos_app;
GRANT SELECT ON public.physical_topology_edges TO fiberos_app;

DROP POLICY IF EXISTS network_service_path_versions_app_read ON public.network_service_path_versions;
CREATE POLICY network_service_path_versions_app_read
ON public.network_service_path_versions
FOR SELECT TO fiberos_app
USING (fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS network_service_path_hops_app_read ON public.network_service_path_hops;
CREATE POLICY network_service_path_hops_app_read
ON public.network_service_path_hops
FOR SELECT TO fiberos_app
USING (fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS network_failure_domains_app_read ON public.network_failure_domains;
CREATE POLICY network_failure_domains_app_read
ON public.network_failure_domains
FOR SELECT TO fiberos_app
USING (fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS network_failure_domain_members_app_read ON public.network_failure_domain_members;
CREATE POLICY network_failure_domain_members_app_read
ON public.network_failure_domain_members
FOR SELECT TO fiberos_app
USING (fiberos_enterprise_tenant_ok(tenant_id));

-- Use the same security-definer tenant predicate for legacy tables so the
-- application role does not depend on direct user_preferences visibility.
DROP POLICY IF EXISTS network_assets_app_read ON public.network_assets;
CREATE POLICY network_assets_app_read
ON public.network_assets
FOR SELECT TO fiberos_app
USING (fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS services_app_read ON public.services;
CREATE POLICY services_app_read
ON public.services
FOR SELECT TO fiberos_app
USING (fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS physical_topology_edges_app_read ON public.physical_topology_edges;
CREATE POLICY physical_topology_edges_app_read
ON public.physical_topology_edges
FOR SELECT TO fiberos_app
USING (fiberos_enterprise_tenant_ok(tenant_id));

-- The linked analyzer must never gain mutation capability through this fix.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON public.network_service_path_versions,
   public.network_service_path_hops,
   public.network_failure_domains,
   public.network_failure_domain_members,
   public.physical_topology_edges
FROM fiberos_app;

COMMIT;
