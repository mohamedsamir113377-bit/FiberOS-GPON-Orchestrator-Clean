-- FiberOS Wave 6: Network Intelligence Layer Foundation
-- Truth boundary: database-backed topology read only.
-- No NMS streaming, no autonomous fault isolation.
create index if not exists idx_network_ports_asset_id on network_ports(asset_id);
