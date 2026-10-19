-- Alpha47 Operational Feature Surfaces
-- Real data-backed surfaces for Call Center/IVR, Crisis Command, and dispatch audit.
-- No synthetic delivery, telephony success, or autonomous financial execution is created here.
BEGIN;

CREATE TABLE IF NOT EXISTS call_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  external_call_id text,
  caller_number text,
  customer_ref text,
  service_id uuid REFERENCES services(id) ON DELETE SET NULL,
  ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing','connected','ivr','queued','in_progress','completed','failed','abandoned')),
  ivr_state text NOT NULL DEFAULT 'welcome',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_call_id)
);
CREATE INDEX IF NOT EXISTS idx_call_sessions_tenant_time ON call_sessions(tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_sessions_customer ON call_sessions(tenant_id, customer_ref);
ALTER TABLE call_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS call_sessions_scope_select ON call_sessions;
CREATE POLICY call_sessions_scope_select ON call_sessions FOR SELECT USING (
  tenant_id = fiberos_current_tenant_id()
  AND fiberos_has_any_role(ARRAY['call_center','ops_manager','area_supervisor','exec','sysadmin'])
);
DROP POLICY IF EXISTS call_sessions_scope_insert ON call_sessions;
CREATE POLICY call_sessions_scope_insert ON call_sessions FOR INSERT WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
  AND fiberos_has_any_role(ARRAY['call_center','ops_manager','area_supervisor','sysadmin'])
);
DROP POLICY IF EXISTS call_sessions_scope_update ON call_sessions;
CREATE POLICY call_sessions_scope_update ON call_sessions FOR UPDATE USING (
  tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
  AND fiberos_has_any_role(ARRAY['call_center','ops_manager','area_supervisor','sysadmin'])
) WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS call_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  call_session_id uuid NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_call_events_session_time ON call_events(call_session_id, occurred_at DESC);
ALTER TABLE call_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS call_events_scope_select ON call_events;
CREATE POLICY call_events_scope_select ON call_events FOR SELECT USING (
  tenant_id = fiberos_current_tenant_id()
  AND fiberos_has_any_role(ARRAY['call_center','ops_manager','area_supervisor','exec','sysadmin'])
);
DROP POLICY IF EXISTS call_events_scope_insert ON call_events;
CREATE POLICY call_events_scope_insert ON call_events FOR INSERT WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
  AND fiberos_has_any_role(ARRAY['call_center','ops_manager','area_supervisor','sysadmin'])
);

CREATE TABLE IF NOT EXISTS incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  incident_key text NOT NULL,
  title text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('P1','P2','P3','P4')),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','investigating','declared','mitigating','resolved','closed')),
  affected_customers integer NOT NULL DEFAULT 0 CHECK (affected_customers >= 0),
  primary_asset_id uuid REFERENCES network_assets(id) ON DELETE SET NULL,
  declared_at timestamptz,
  resolved_at timestamptz,
  sla_deadline timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, incident_key)
);
CREATE INDEX IF NOT EXISTS idx_incidents_tenant_state ON incidents(tenant_id, state, severity, created_at DESC);
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS incidents_scope_select ON incidents;
CREATE POLICY incidents_scope_select ON incidents FOR SELECT USING (
  tenant_id = fiberos_current_tenant_id()
  AND fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','exec','dispatcher','sysadmin'])
);
DROP POLICY IF EXISTS incidents_scope_write ON incidents;
CREATE POLICY incidents_scope_write ON incidents FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
  AND fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','dispatcher','sysadmin'])
) WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS incident_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_incident_events_time ON incident_events(incident_id, occurred_at DESC);
ALTER TABLE incident_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS incident_events_scope_select ON incident_events;
CREATE POLICY incident_events_scope_select ON incident_events FOR SELECT USING (
  tenant_id = fiberos_current_tenant_id()
  AND fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','exec','dispatcher','sysadmin'])
);
DROP POLICY IF EXISTS incident_events_scope_insert ON incident_events;
CREATE POLICY incident_events_scope_insert ON incident_events FOR INSERT WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
  AND fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','dispatcher','sysadmin'])
);

CREATE TABLE IF NOT EXISTS dispatch_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL,
  required_skill text NOT NULL,
  sla_deadline timestamptz,
  priority integer NOT NULL DEFAULT 0,
  request_payload jsonb NOT NULL,
  result_payload jsonb,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','ranked','assigned','no_candidate','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_dispatch_requests_tenant_time ON dispatch_requests(tenant_id, created_at DESC);
ALTER TABLE dispatch_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dispatch_requests_scope_select ON dispatch_requests;
CREATE POLICY dispatch_requests_scope_select ON dispatch_requests FOR SELECT USING (
  tenant_id = fiberos_current_tenant_id()
  AND fiberos_has_any_role(ARRAY['dispatcher','ops_manager','area_supervisor','exec','sysadmin'])
);
DROP POLICY IF EXISTS dispatch_requests_scope_insert ON dispatch_requests;
CREATE POLICY dispatch_requests_scope_insert ON dispatch_requests FOR INSERT WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
  AND fiberos_has_any_role(ARRAY['dispatcher','ops_manager','area_supervisor','sysadmin'])
);

COMMIT;
