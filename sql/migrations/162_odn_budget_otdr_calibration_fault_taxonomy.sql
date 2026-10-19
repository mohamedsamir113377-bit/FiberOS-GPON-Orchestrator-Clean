-- 162_odn_budget_otdr_calibration_fault_taxonomy.sql
-- P0 from FTTH Deep Specs Gap Report (ITU-T Manual 2009 + FTTH Handbook Ed.9).
-- SOURCE tables only; does not claim live instrument connectivity.
BEGIN;

-- Extend fault_jobs to accept handbook six codes alongside field intake types.
ALTER TABLE fault_jobs DROP CONSTRAINT IF EXISTS fault_jobs_fault_type_check;
ALTER TABLE fault_jobs ADD CONSTRAINT fault_jobs_fault_type_check
  CHECK (fault_type IN (
    'OPTICAL_LOSS','NO_SYNC','DROP_DAMAGE','CPE','POWER','INTERMITTENT','UNKNOWN',
    'DYING_GASP','LOS','LOFI','HIGH_BER','HIGH_TEMPERATURE','ROGUE_ONT'
  ));

CREATE TABLE IF NOT EXISTS field_test_tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tool_kind text NOT NULL CHECK (tool_kind IN ('OTDR','POWER_METER','VFL','INSPECTION_SCOPE','OLTS')),
  serial_number text NOT NULL,
  manufacturer text,
  model text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, tool_kind, serial_number)
);

CREATE TABLE IF NOT EXISTS field_tool_calibrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tool_id uuid NOT NULL REFERENCES field_test_tools(id) ON DELETE CASCADE,
  certificate_id text NOT NULL,
  calibrated_at timestamptz,
  valid_until timestamptz NOT NULL,
  traceable_reference text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until > COALESCE(calibrated_at, valid_until - interval '1 day'))
);

CREATE INDEX IF NOT EXISTS idx_field_tool_calibrations_tool_valid
  ON field_tool_calibrations(tenant_id, tool_id, valid_until DESC);

CREATE TABLE IF NOT EXISTS odn_power_budget_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  odn_class text NOT NULL CHECK (odn_class IN ('A','B','C','B+','C+')),
  length_km numeric(12,4) NOT NULL CHECK (length_km >= 0),
  fiber_attenuation_db_per_km numeric(10,5) NOT NULL CHECK (fiber_attenuation_db_per_km >= 0),
  splices integer NOT NULL DEFAULT 0 CHECK (splices >= 0),
  splice_loss_db numeric(10,5) NOT NULL DEFAULT 0.1 CHECK (splice_loss_db >= 0),
  connectors integer NOT NULL DEFAULT 0 CHECK (connectors >= 0),
  connector_loss_db numeric(10,5) NOT NULL DEFAULT 0.35 CHECK (connector_loss_db >= 0),
  splitter_loss_db numeric(10,5) NOT NULL DEFAULT 0 CHECK (splitter_loss_db >= 0),
  explicit_loss_db numeric(10,5) NOT NULL DEFAULT 0 CHECK (explicit_loss_db >= 0),
  design_margin_db numeric(10,5) NOT NULL DEFAULT 0 CHECK (design_margin_db >= 0),
  maintenance_margin_db numeric(10,5) NOT NULL DEFAULT 0 CHECK (maintenance_margin_db >= 0),
  path_loss_db numeric(12,5) NOT NULL,
  total_with_margins_db numeric(12,5) NOT NULL,
  limit_db numeric(12,5) NOT NULL,
  status text NOT NULL CHECK (status IN ('ACCEPTED','WARNING_UNDER_CLASS_MIN','REJECTED_OVER_BUDGET')),
  rejected boolean NOT NULL DEFAULT false,
  source_ref text NOT NULL DEFAULT 'ITU-T Manual 2009 p.262-264',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_odn_budget_tenant_created
  ON odn_power_budget_assessments(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS otdr_trace_acquisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tool_id uuid REFERENCES field_test_tools(id) ON DELETE SET NULL,
  calibration_id uuid REFERENCES field_tool_calibrations(id) ON DELETE SET NULL,
  wavelength_nm numeric(8,2) NOT NULL,
  pulse_width_ns numeric(12,3),
  ior numeric(8,6) NOT NULL DEFAULT 1.468,
  direction text NOT NULL CHECK (direction IN ('A_TO_B','B_TO_A','UNKNOWN')),
  is_maintenance_band boolean NOT NULL DEFAULT false,
  pair_id uuid,
  splice_loss_db numeric(10,5),
  status text NOT NULL DEFAULT 'RECORDED'
    CHECK (status IN ('RECORDED','REJECTED_UNCALIBRATED_TOOL','REJECTED_UNIDIRECTIONAL_SPLICE','ACCEPTED_BIDIRECTIONAL')),
  evidence_vault_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otdr_acq_tenant_pair
  ON otdr_trace_acquisitions(tenant_id, pair_id, direction);

-- RLS
ALTER TABLE field_test_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_test_tools FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS field_test_tools_tenant ON field_test_tools;
CREATE POLICY field_test_tools_tenant ON field_test_tools
  USING (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()));

ALTER TABLE field_tool_calibrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_tool_calibrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS field_tool_calibrations_tenant ON field_tool_calibrations;
CREATE POLICY field_tool_calibrations_tenant ON field_tool_calibrations
  USING (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()));

ALTER TABLE odn_power_budget_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE odn_power_budget_assessments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS odn_power_budget_assessments_tenant ON odn_power_budget_assessments;
CREATE POLICY odn_power_budget_assessments_tenant ON odn_power_budget_assessments
  USING (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()));

ALTER TABLE otdr_trace_acquisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE otdr_trace_acquisitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS otdr_trace_acquisitions_tenant ON otdr_trace_acquisitions;
CREATE POLICY otdr_trace_acquisitions_tenant ON otdr_trace_acquisitions
  USING (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()));

COMMIT;
