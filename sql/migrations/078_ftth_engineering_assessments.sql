-- R14.1 Alpha85: append-only, tenant-scoped engineering assessment ledger.
-- Calculations are deterministic application code; DB stores immutable evidence/results.
BEGIN;
CREATE TABLE IF NOT EXISTS fiberos_ftth_engineering_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  asset_id uuid REFERENCES network_assets(id) ON DELETE RESTRICT,
  assessment_kind text NOT NULL CHECK (assessment_kind IN ('OPTICAL_BUDGET','RX_RESIDUAL','OTDR_BIDIRECTIONAL')),
  evidence_class text NOT NULL CHECK (evidence_class IN ('observed','measured','derived','client_declared','simulated','unverified')),
  standards_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_payload jsonb NOT NULL,
  result_payload jsonb NOT NULL,
  result_sha256 text NOT NULL CHECK (result_sha256 ~ '^[0-9a-f]{64}$'),
  execution_authorized boolean NOT NULL DEFAULT false CHECK (execution_authorized = false),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE fiberos_ftth_engineering_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiberos_ftth_engineering_assessments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fiberos_ftth_engineering_assessments_tenant ON fiberos_ftth_engineering_assessments;
CREATE POLICY fiberos_ftth_engineering_assessments_tenant ON fiberos_ftth_engineering_assessments FOR ALL TO authenticated USING (fiberos_enterprise_tenant_ok(tenant_id)) WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id));
CREATE INDEX IF NOT EXISTS idx_ftth_engineering_assessments_tenant_asset_created ON fiberos_ftth_engineering_assessments(tenant_id,asset_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ftth_engineering_assessments_tenant_kind_created ON fiberos_ftth_engineering_assessments(tenant_id,assessment_kind,created_at DESC);
CREATE OR REPLACE FUNCTION fiberos_ftth_engineering_assessments_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'FTTH_ENGINEERING_ASSESSMENT_IMMUTABLE'; END; $$;
DROP TRIGGER IF EXISTS trg_ftth_engineering_assessments_no_update ON fiberos_ftth_engineering_assessments;
CREATE TRIGGER trg_ftth_engineering_assessments_no_update BEFORE UPDATE ON fiberos_ftth_engineering_assessments FOR EACH ROW EXECUTE FUNCTION fiberos_ftth_engineering_assessments_immutable();
DROP TRIGGER IF EXISTS trg_ftth_engineering_assessments_no_delete ON fiberos_ftth_engineering_assessments;
CREATE TRIGGER trg_ftth_engineering_assessments_no_delete BEFORE DELETE ON fiberos_ftth_engineering_assessments FOR EACH ROW EXECUTE FUNCTION fiberos_ftth_engineering_assessments_immutable();
COMMIT;
