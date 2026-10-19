-- R14.1 Alpha85: sovereign GIS spatial-intelligence query support.
-- Additive/read-only only. No synthetic geography, routing success, or impact verdicts.
BEGIN;

CREATE INDEX IF NOT EXISTS idx_fiberos_asset_dna_tenant_asset_version
  ON fiberos_asset_dna(tenant_id, asset_id, dna_version DESC);
CREATE INDEX IF NOT EXISTS idx_physical_topology_edges_tenant_active_from
  ON physical_topology_edges(tenant_id, active, from_asset_id);
CREATE INDEX IF NOT EXISTS idx_physical_topology_edges_tenant_active_to
  ON physical_topology_edges(tenant_id, active, to_asset_id);
CREATE INDEX IF NOT EXISTS idx_network_ports_asset_customer
  ON network_ports(asset_id, connected_customer_id);

COMMIT;
