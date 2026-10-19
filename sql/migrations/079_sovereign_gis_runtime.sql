-- R14.1 Alpha85: sovereign GIS runtime support.
-- No synthetic spatial records are inserted. This migration only strengthens
-- spatial indexes required by read-only MVT/GeoJSON queries.
BEGIN;
CREATE INDEX IF NOT EXISTS idx_network_assets_gps_tenant_gist ON network_assets USING gist(gps) WHERE gps IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ftth_duct_segments_tenant_geom_gist ON ftth_duct_segments USING gist(geometry);
CREATE INDEX IF NOT EXISTS idx_ftth_cable_segments_tenant_geom_gist ON ftth_cable_segments USING gist(geometry);
CREATE INDEX IF NOT EXISTS idx_ftth_construction_evidence_tenant_gps_gist ON ftth_construction_evidence USING gist(gps) WHERE gps IS NOT NULL;
COMMIT;
