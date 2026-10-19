-- 167_gis_snap_and_regions.sql
-- Optional operational regions for geotagging + append-only snap audit.
BEGIN;

CREATE TABLE IF NOT EXISTS operational_regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  region_code text NOT NULL,
  name text NOT NULL,
  boundary geometry(MultiPolygon, 4326),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, region_code)
);

CREATE INDEX IF NOT EXISTS idx_operational_regions_boundary
  ON operational_regions USING GIST (boundary);

CREATE TABLE IF NOT EXISTS gis_snap_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  layer text NOT NULL CHECK (layer IN ('FIBER_CABLE','DUCT')),
  input_lat double precision NOT NULL,
  input_lon double precision NOT NULL,
  segment_id uuid,
  distance_m double precision,
  snap_lat double precision,
  snap_lon double precision,
  measure_fraction double precision,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gis_snap_events_tenant
  ON gis_snap_events (tenant_id, created_at DESC);

ALTER TABLE operational_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_regions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operational_regions_tenant ON operational_regions;
CREATE POLICY operational_regions_tenant ON operational_regions
  USING (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()));

ALTER TABLE gis_snap_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE gis_snap_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gis_snap_events_tenant ON gis_snap_events;
CREATE POLICY gis_snap_events_tenant ON gis_snap_events
  USING (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()));

COMMIT;
