-- R14.1 Enterprise authority scope and dashboard contract foundation.
BEGIN;
CREATE TABLE IF NOT EXISTS enterprise_scope_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  position_id uuid NOT NULL REFERENCES enterprise_positions(id) ON DELETE CASCADE, scope_type text NOT NULL
    CHECK(scope_type IN ('enterprise','sector','region','central','team','work_package','contractor','warehouse','network_area')),
  scope_id uuid, capabilities text[] NOT NULL DEFAULT '{}', valid_from timestamptz NOT NULL DEFAULT now(), valid_to timestamptz,
  granted_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_enterprise_scope_position ON enterprise_scope_grants(tenant_id,position_id,scope_type,scope_id);

CREATE TABLE IF NOT EXISTS enterprise_dashboard_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  dashboard_key text NOT NULL, audience_scope_type text NOT NULL, metric_key text NOT NULL, source_domain text NOT NULL,
  freshness_seconds integer NOT NULL CHECK(freshness_seconds>=0), drilldown_subject_type text, policy_version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true, UNIQUE(tenant_id,dashboard_key,metric_key)
);

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['enterprise_scope_grants','enterprise_dashboard_contracts'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON %I',t,t);
  EXECUTE format('CREATE POLICY %I_tenant ON %I FOR ALL TO authenticated USING (fiberos_enterprise_tenant_ok(tenant_id)) WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id))',t,t);
END LOOP; END $$;

ALTER TABLE enterprise_scope_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_dashboard_contracts ENABLE ROW LEVEL SECURITY;
COMMIT;
