-- 118_deep_field_operations_intelligence.sql
-- Deterministic operational intelligence extensions.
-- No synthetic telemetry, no autonomous dispatch, no predictive claims.
BEGIN;

CREATE TABLE IF NOT EXISTS alarm_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  external_alarm_id text NOT NULL,
  asset_id uuid NOT NULL REFERENCES network_assets(id) ON DELETE CASCADE,
  alarm_code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('INFO','WARN','MAJOR','CRITICAL')),
  source text NOT NULL CHECK (source IN ('nms','operator','system','field')),
  correlation_key text,
  observed_at timestamptz NOT NULL,
  cleared_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_alarm_id)
);
CREATE INDEX IF NOT EXISTS idx_alarm_signals_tenant_time ON alarm_signals(tenant_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_alarm_signals_asset_time ON alarm_signals(tenant_id, asset_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_alarm_signals_correlation ON alarm_signals(tenant_id, correlation_key, observed_at DESC);
ALTER TABLE alarm_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE alarm_signals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS alarm_signals_scope_select ON alarm_signals;
CREATE POLICY alarm_signals_scope_select ON alarm_signals FOR SELECT USING (fiberos_enterprise_tenant_ok(tenant_id));
DROP POLICY IF EXISTS alarm_signals_scope_insert ON alarm_signals;
CREATE POLICY alarm_signals_scope_insert ON alarm_signals FOR INSERT WITH CHECK (
  fiberos_enterprise_tenant_ok(tenant_id)
  AND fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','dispatcher','sysadmin'])
);

CREATE TABLE IF NOT EXISTS evidence_chain_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_id uuid,
  chain_hash char(64) NOT NULL,
  certificate jsonb NOT NULL,
  status text NOT NULL DEFAULT 'OBSERVED' CHECK (status IN ('OBSERVED','COMPLETE','BLOCKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ticket_id, chain_hash)
);
CREATE INDEX IF NOT EXISTS idx_evidence_chain_ticket_time ON evidence_chain_certificates(tenant_id,ticket_id,created_at DESC);
ALTER TABLE evidence_chain_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_chain_certificates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS evidence_chain_certificates_select ON evidence_chain_certificates;
CREATE POLICY evidence_chain_certificates_select ON evidence_chain_certificates FOR SELECT USING (fiberos_enterprise_tenant_ok(tenant_id));
DROP POLICY IF EXISTS evidence_chain_certificates_insert ON evidence_chain_certificates;
CREATE POLICY evidence_chain_certificates_insert ON evidence_chain_certificates FOR INSERT WITH CHECK (
  fiberos_enterprise_tenant_ok(tenant_id)
  AND fiberos_has_any_role(ARRAY['technician','team_lead','qc','ops_manager','area_supervisor','dispatcher','sysadmin'])
);

CREATE OR REPLACE VIEW pon_capacity_intelligence WITH (security_invoker = true) AS
SELECT
  a.id AS asset_id,
  a.tenant_id,
  a.asset_code,
  a.asset_type,
  a.total_ports,
  count(p.id) FILTER (WHERE p.status = 'used')::int AS used_ports,
  count(p.id) FILTER (WHERE p.status = 'reserved')::int AS reserved_ports,
  count(p.id)::int AS provisioned_ports,
  GREATEST(COALESCE(a.total_ports,0) - count(p.id) FILTER (WHERE p.status IN ('used','reserved')), 0)::int AS free_ports,
  CASE WHEN COALESCE(a.total_ports,0)=0 THEN 0
       ELSE round((count(p.id) FILTER (WHERE p.status IN ('used','reserved'))::numeric / a.total_ports::numeric) * 100, 2)
  END AS utilization_pct,
  (COALESCE(a.total_ports,0) < count(p.id) FILTER (WHERE p.status IN ('used','reserved'))) AS over_capacity
FROM network_assets a
LEFT JOIN network_ports p ON p.asset_id=a.id
GROUP BY a.id, a.tenant_id, a.asset_code, a.asset_type, a.total_ports;

CREATE OR REPLACE VIEW optical_health_timeline WITH (security_invoker = true) AS
SELECT
  na.tenant_id,
  om.id AS measurement_id,
  om.asset_id,
  om.port_id,
  na.asset_code,
  na.asset_type,
  om.measurement_type,
  om.value_numeric,
  om.unit,
  om.source,
  om.sor_file_ref,
  om.measured_by,
  om.measured_at,
  lag(om.value_numeric) OVER (PARTITION BY om.asset_id, om.measurement_type ORDER BY om.measured_at, om.id) AS previous_value,
  (om.value_numeric - lag(om.value_numeric) OVER (PARTITION BY om.asset_id, om.measurement_type ORDER BY om.measured_at, om.id)) AS delta_from_previous
FROM optical_measurements om
JOIN network_assets na ON na.id = om.asset_id;

COMMENT ON VIEW pon_capacity_intelligence IS 'Derived from network_ports state and network_assets total_ports; no manual capacity assertion.';
COMMENT ON VIEW optical_health_timeline IS 'Append-only optical measurement history with deterministic delta; no forecasting.';

COMMIT;
