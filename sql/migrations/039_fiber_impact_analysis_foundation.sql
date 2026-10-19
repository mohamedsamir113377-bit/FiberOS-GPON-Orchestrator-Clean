-- Fiber impact analysis foundation
-- Advisory read support only; no automatic isolation or remediation.
create index if not exists idx_physical_topology_edges_tenant_assets
on physical_topology_edges(tenant_id, from_asset_id, to_asset_id);
