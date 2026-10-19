-- Fiber graph traversal foundation
-- Read-path support only; no automated remediation.
create index if not exists idx_physical_topology_edges_tenant_from_to on physical_topology_edges(tenant_id, from_asset_id, to_asset_id);
