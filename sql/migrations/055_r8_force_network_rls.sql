-- FiberOS R8: force RLS on legacy network tenant tables.
-- These tables were tenant-scoped and RLS-enabled earlier, but FORCE RLS was
-- absent. This closes the owner-bypass gap for the static security contract.
ALTER TABLE network_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_assets FORCE ROW LEVEL SECURITY;
ALTER TABLE network_ports ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_ports FORCE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_network_assets_tenant_id_r8 ON network_assets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_network_ports_tenant_id_r8 ON network_ports(tenant_id);
