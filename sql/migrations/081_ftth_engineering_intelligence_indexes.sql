-- R14.1 Alpha85: indexes for read-only FTTH engineering intelligence.
-- No synthetic engineering/measurement data is inserted.
BEGIN;
CREATE INDEX IF NOT EXISTS idx_optical_measurements_tenant_asset_type_time_intel
  ON optical_measurements(tenant_id, asset_id, measurement_type, measured_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_ftth_engineering_assessments_tenant_asset_kind_time_intel
  ON fiberos_ftth_engineering_assessments(tenant_id, asset_id, assessment_kind, created_at DESC, id DESC);
COMMIT;
