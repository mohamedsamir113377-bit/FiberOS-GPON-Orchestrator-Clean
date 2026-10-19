-- GIS Fusion Foundation: read-only spatial layer contract.
-- No synthetic assets. Uses existing tenant-owned spatial records.
create index if not exists network_assets_tenant_gps_idx on network_assets(tenant_id) where gps is not null;
