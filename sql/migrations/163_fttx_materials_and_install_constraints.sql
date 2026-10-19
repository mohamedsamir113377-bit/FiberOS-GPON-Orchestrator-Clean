-- 163_fttx_materials_and_install_constraints.sql
-- Operator-selectable materials catalog + install constraint records.
-- Values derived from ITU-T Manual 2009, FTTH Handbook Ed.9, STL FTTX NETWORKS 2014.
-- Does not invent vendor datasheet limits; operators may override via declared fields.
BEGIN;

CREATE TABLE IF NOT EXISTS tenant_fttx_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  architecture_code text NOT NULL DEFAULT 'FTTH'
    CHECK (architecture_code IN ('FTTN','FTTC','FTTB','FTTH','FTTP','FTTD','FTTA')),
  topology_code text NOT NULL DEFAULT 'P2MP_PON'
    CHECK (topology_code IN ('P2P_ACTIVE','P2MP_PON')),
  pon_technology text
    CHECK (pon_technology IS NULL OR pon_technology IN ('BPON','GPON','EPON','10G-EPON','10G-GPON')),
  default_fiber_standard text NOT NULL DEFAULT 'G.652.D',
  default_connector_polish text NOT NULL DEFAULT 'APC'
    CHECK (default_connector_polish IN ('PC','APC')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

CREATE TABLE IF NOT EXISTS cable_plant_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_code text NOT NULL,
  fiber_standard text NOT NULL,
  cable_diameter_mm numeric(8,3) NOT NULL CHECK (cable_diameter_mm > 0),
  install_method text NOT NULL
    CHECK (install_method IN (
      'DUCT_PULL','DIRECT_BURY_PLOUGH','DIRECT_BURY_TRENCH','AERIAL',
      'MICRODUCT_BLOW','MICRODUCT_FLOAT','FIGURE_OF_EIGHT_PULL'
    )),
  max_pull_force_n numeric(12,2),
  bend_radius_dynamic_mm numeric(10,2),
  bend_radius_static_mm numeric(10,2),
  length_m numeric(12,2) NOT NULL CHECK (length_m >= 0),
  fire_class text,
  duct_occupied boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, segment_code)
);

CREATE TABLE IF NOT EXISTS install_constraint_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id uuid REFERENCES cable_plant_segments(id) ON DELETE SET NULL,
  evaluation_kind text NOT NULL CHECK (evaluation_kind IN ('BEND_RADIUS','MICRODUCT_BLOW','PULL_FORCE')),
  status text NOT NULL,
  accepted boolean NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS optical_splitter_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_code text NOT NULL,
  profile_key text NOT NULL
    CHECK (profile_key IN ('1x2','1x4','1x8','1x16','1x32','1x64','1x128')),
  ratio integer NOT NULL CHECK (ratio >= 2),
  declared_loss_db numeric(10,5) NOT NULL CHECK (declared_loss_db >= 0),
  parent_splitter_id uuid REFERENCES optical_splitter_assets(id) ON DELETE SET NULL,
  location_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, asset_code)
);

CREATE INDEX IF NOT EXISTS idx_cable_plant_tenant ON cable_plant_segments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_splitter_assets_tenant ON optical_splitter_assets(tenant_id);

ALTER TABLE tenant_fttx_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_fttx_profile FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_fttx_profile_tenant ON tenant_fttx_profile;
CREATE POLICY tenant_fttx_profile_tenant ON tenant_fttx_profile
  USING (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()));

ALTER TABLE cable_plant_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE cable_plant_segments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cable_plant_segments_tenant ON cable_plant_segments;
CREATE POLICY cable_plant_segments_tenant ON cable_plant_segments
  USING (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()));

ALTER TABLE install_constraint_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE install_constraint_evaluations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS install_constraint_evaluations_tenant ON install_constraint_evaluations;
CREATE POLICY install_constraint_evaluations_tenant ON install_constraint_evaluations
  USING (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()));

ALTER TABLE optical_splitter_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE optical_splitter_assets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS optical_splitter_assets_tenant ON optical_splitter_assets;
CREATE POLICY optical_splitter_assets_tenant ON optical_splitter_assets
  USING (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()));

COMMIT;
