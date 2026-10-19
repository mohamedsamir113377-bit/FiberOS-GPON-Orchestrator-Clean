-- Wave 7: Network topology graph foundation
-- Read-model support only. No synthetic topology generation.
create index if not exists idx_physical_topology_edges_tenant_from_to
on physical_topology_edges(tenant_id, from_asset_id, to_asset_id);
