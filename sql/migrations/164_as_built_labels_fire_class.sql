-- 164_as_built_labels_fire_class.sql
-- As-built vs design deviations, hierarchical labels, fire-class options on plant.
-- Handbook labeling p.105-106; gap report P1.12 / P2.14-15.
BEGIN;

CREATE TABLE IF NOT EXISTS as_built_deviations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  design_ref text NOT NULL,
  as_built_ref text NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'ROUTE_GEOMETRY','LENGTH_M','SPLICE_COUNT','SPLITTER_RATIO','FIBER_STANDARD',
    'CONNECTOR_COUNT','CABLE_TYPE','PORT_ASSIGNMENT','LABEL_CODE','OTHER'
  )),
  design_value text,
  as_built_value text,
  matched boolean NOT NULL DEFAULT false,
  reason text,
  severity text NOT NULL DEFAULT 'MINOR'
    CHECK (severity IN ('INFO','MINOR','MAJOR','CRITICAL')),
  affects_service boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_as_built_deviations_tenant
  ON as_built_deviations(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS network_hierarchical_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label_code text NOT NULL,
  segment_order text[] NOT NULL,
  segments text[] NOT NULL,
  separator text NOT NULL DEFAULT '-',
  fire_class text CHECK (
    fire_class IS NULL OR fire_class IN (
      'UNDECLARED','CPR_Eca','CPR_Dca','CPR_Cca','CPR_B2ca','CPR_B1ca','CPR_Aca',
      'IEC_60332_1','IEC_60332_3','LSZH','OFNR','OFNP','OTHER'
    )
  ),
  asset_ref text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, label_code)
);

CREATE INDEX IF NOT EXISTS idx_network_labels_tenant
  ON network_hierarchical_labels(tenant_id, label_code);

-- Strengthen fire_class on cable plant (was free text in 163)
ALTER TABLE cable_plant_segments
  DROP CONSTRAINT IF EXISTS cable_plant_segments_fire_class_check;
ALTER TABLE cable_plant_segments
  ADD CONSTRAINT cable_plant_segments_fire_class_check
  CHECK (
    fire_class IS NULL OR fire_class IN (
      'UNDECLARED','CPR_Eca','CPR_Dca','CPR_Cca','CPR_B2ca','CPR_B1ca','CPR_Aca',
      'IEC_60332_1','IEC_60332_3','LSZH','OFNR','OFNP','OTHER'
    )
  );

ALTER TABLE as_built_deviations ENABLE ROW LEVEL SECURITY;
ALTER TABLE as_built_deviations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS as_built_deviations_tenant ON as_built_deviations;
CREATE POLICY as_built_deviations_tenant ON as_built_deviations
  USING (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()));

ALTER TABLE network_hierarchical_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_hierarchical_labels FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS network_hierarchical_labels_tenant ON network_hierarchical_labels;
CREATE POLICY network_hierarchical_labels_tenant ON network_hierarchical_labels
  USING (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()));

COMMIT;
