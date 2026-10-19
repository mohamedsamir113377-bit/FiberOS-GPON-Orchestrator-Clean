-- 136_network_reality_kernel.sql
-- Master Operating Statement 2026-10-07: first source-backed Deep Reality Kernel boundary.
-- No synthetic network facts are inserted.
BEGIN;

CREATE TABLE IF NOT EXISTS network_asset_semantics (
  asset_id uuid PRIMARY KEY REFERENCES network_assets(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  semantic_class text NOT NULL CHECK (semantic_class IN ('PHYSICAL_ASSET','LOGICAL_RESOURCE','CUSTOMER_ENDPOINT','SERVICE_RESOURCE')),
  normalized_class text NOT NULL,
  operator_code text,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE TABLE IF NOT EXISTS network_service_path_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK (version_no > 0),
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  path jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(path)='array'),
  path_hash text NOT NULL,
  change_reason text,
  change_order text,
  actor_id uuid,
  pre_state_hash text,
  post_state_hash text,
  evidence_id uuid REFERENCES evidence(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed','accepted','live','retired','conflicted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, service_id, version_no),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE TABLE IF NOT EXISTS network_reality_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  asset_id uuid REFERENCES network_assets(id) ON DELETE RESTRICT,
  service_id uuid REFERENCES services(id) ON DELETE RESTRICT,
  observation_type text NOT NULL,
  evidence_class text NOT NULL CHECK (evidence_class IN ('observed','measured','derived','client_declared','simulated','unverified')),
  source text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  actor_id uuid,
  device_id text,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, content_hash)
);

CREATE TABLE IF NOT EXISTS network_truth_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  claim_type text NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid,
  assertion jsonb NOT NULL,
  status text NOT NULL DEFAULT 'unverified' CHECK (status IN ('accepted','live','conflicted','stale','unknown','unverified')),
  evidence_ids uuid[] NOT NULL DEFAULT '{}',
  authority text NOT NULL DEFAULT 'database',
  assessed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS network_counterfactual_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name text NOT NULL,
  scenario_type text NOT NULL CHECK (scenario_type IN ('failure','isolation','capacity','relocation','reconfiguration','route')),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  baseline_hash text NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'simulated' CHECK (status IN ('simulated','approved','rejected','expired')),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS network_authorized_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  command_type text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  requested_by uuid,
  authorization_ref text,
  policy_ref text,
  impact_budget jsonb NOT NULL DEFAULT '{}'::jsonb,
  pre_state_hash text,
  post_state_hash text,
  status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','authorized','executing','verified','rolled_back','rejected','failed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  verified_at timestamptz,
  idempotency_key text NOT NULL,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS network_integrity_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  finding_code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('CRITICAL','HIGH','MEDIUM','LOW','INFO')),
  subject_type text,
  subject_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (tenant_id, finding_code, subject_type, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_network_asset_semantics_tenant_class ON network_asset_semantics(tenant_id, normalized_class);
CREATE INDEX IF NOT EXISTS idx_service_path_versions_lookup ON network_service_path_versions(tenant_id, service_id, valid_from, valid_to);
CREATE INDEX IF NOT EXISTS idx_reality_observations_asset_time ON network_reality_observations(tenant_id, asset_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_truth_claims_subject ON network_truth_claims(tenant_id, subject_type, subject_id, status);
CREATE INDEX IF NOT EXISTS idx_counterfactual_tenant_time ON network_counterfactual_scenarios(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_authorized_commands_target ON network_authorized_commands(tenant_id, target_type, target_id, status);
CREATE INDEX IF NOT EXISTS idx_integrity_findings_open ON network_integrity_findings(tenant_id, severity, detected_at DESC) WHERE resolved_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ftth_odn_active_from_port
  ON ftth_odn_connections(tenant_id, from_port_id)
  WHERE from_port_id IS NOT NULL AND status IN ('installed','tested','accepted','live');
CREATE UNIQUE INDEX IF NOT EXISTS uq_ftth_odn_active_to_port
  ON ftth_odn_connections(tenant_id, to_port_id)
  WHERE to_port_id IS NOT NULL AND status IN ('installed','tested','accepted','live');

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['network_asset_semantics','network_service_path_versions','network_reality_observations','network_truth_claims','network_counterfactual_scenarios','network_authorized_commands','network_integrity_findings'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_tenant ON public.%I FOR ALL TO authenticated USING (fiberos_enterprise_tenant_ok(tenant_id)) WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id))', t, t);
  END LOOP;
END $$;

COMMENT ON TABLE network_reality_observations IS 'Evidence-bearing observations; classification is explicit and non-promoting.';
COMMENT ON TABLE network_truth_claims IS 'Assertions separated from physical objects and tied to evidence IDs.';
COMMENT ON TABLE network_counterfactual_scenarios IS 'Non-live simulations; results cannot silently mutate authoritative state.';
COMMENT ON TABLE network_authorized_commands IS 'Bounded commands requiring policy, authorization, idempotency and post-condition proof.';
COMMENT ON TABLE network_integrity_findings IS 'Persistent contradictions detected by the network self-audit layer.';

COMMIT;
