-- 168_gis_corridor_measure_integrity.sql
-- Spatial integrity indexes + measure ledger + dig conflict audit.
BEGIN;

-- Ensure GIST indexes (idempotent) on operational spatial columns
CREATE INDEX IF NOT EXISTS idx_ftth_cable_segments_geom_gist
  ON ftth_cable_segments USING GIST (geometry);
CREATE INDEX IF NOT EXISTS idx_ftth_duct_segments_geom_gist
  ON ftth_duct_segments USING GIST (geometry);
CREATE INDEX IF NOT EXISTS idx_operational_regions_boundary_gist
  ON operational_regions USING GIST (boundary);
CREATE INDEX IF NOT EXISTS idx_ftth_civil_inspections_geom_gist
  ON ftth_civil_inspections USING GIST (geometry)
  WHERE geometry IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_network_assets_gps_gist
  ON network_assets USING GIST (gps)
  WHERE gps IS NOT NULL;

-- Dig / civil work proposals for conflict checks
CREATE TABLE IF NOT EXISTS gis_dig_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  proposal_code text NOT NULL,
  dig_geom geometry(Polygon, 4326) NOT NULL,
  buffer_m numeric(6,2) NOT NULL DEFAULT 2
    CHECK (buffer_m >= 0.5 AND buffer_m <= 50),
  status text NOT NULL DEFAULT 'PROPOSED'
    CHECK (status IN ('PROPOSED','APPROVED','REJECTED','COMPLETED','CANCELLED')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, proposal_code)
);
CREATE INDEX IF NOT EXISTS idx_gis_dig_proposals_geom_gist
  ON gis_dig_proposals USING GIST (dig_geom);

CREATE TABLE IF NOT EXISTS gis_corridor_conflict_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dig_proposal_id uuid REFERENCES gis_dig_proposals(id) ON DELETE SET NULL,
  layer text NOT NULL CHECK (layer IN ('FIBER_CABLE','DUCT')),
  segment_id uuid,
  distance_m double precision,
  severity text NOT NULL CHECK (severity IN ('CRITICAL','WARNING','CLEAR')),
  buffer_m numeric(6,2) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gis_corridor_conflict_tenant
  ON gis_corridor_conflict_events (tenant_id, created_at DESC);

-- Linear measure / OTDR map binding ledger (append-only)
CREATE TABLE IF NOT EXISTS gis_linear_measure_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  layer text NOT NULL CHECK (layer IN ('FIBER_CABLE','DUCT')),
  segment_id uuid NOT NULL,
  measure_fraction double precision
    CHECK (measure_fraction IS NULL OR (measure_fraction >= 0 AND measure_fraction <= 1)),
  measure_m double precision,
  otdr_meters double precision,
  map_lat double precision,
  map_lon double precision,
  event_kind text NOT NULL
    CHECK (event_kind IN ('SNAP','INTERPOLATE','OTDR_BIND','SUBSTRING')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gis_linear_measure_tenant_seg
  ON gis_linear_measure_events (tenant_id, segment_id, created_at DESC);

-- Enrich snap events with optional measure persistence already partially present
ALTER TABLE gis_snap_events
  ADD COLUMN IF NOT EXISTS length_m double precision;

ALTER TABLE gis_dig_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gis_dig_proposals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gis_dig_proposals_tenant ON gis_dig_proposals;
CREATE POLICY gis_dig_proposals_tenant ON gis_dig_proposals
  USING (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()));

ALTER TABLE gis_corridor_conflict_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE gis_corridor_conflict_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gis_corridor_conflict_events_tenant ON gis_corridor_conflict_events;
CREATE POLICY gis_corridor_conflict_events_tenant ON gis_corridor_conflict_events
  USING (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()));

ALTER TABLE gis_linear_measure_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE gis_linear_measure_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gis_linear_measure_events_tenant ON gis_linear_measure_events;
CREATE POLICY gis_linear_measure_events_tenant ON gis_linear_measure_events
  USING (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()));

COMMIT;
