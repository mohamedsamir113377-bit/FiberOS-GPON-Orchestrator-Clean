-- 147_entitlement_usage_order_sla_foundations.sql
-- Commercial Control Plane foundations:
--   1) Entitlement + Usage Engine (authoritative server-side metering)
--   2) Customer service/order management skeleton
--   3) SLA contract entity with evidence-bound clocks (no UI timers)
--
-- Truth boundaries:
-- - Usage is append-only ledger facts; never inferred from the browser.
-- - Entitlement denial is explicit; never silent bypass.
-- - Quote-required commercial amounts remain null until configured.
-- - SLA clocks use documented event timestamps only.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Metric catalog (stable machine codes)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portal_usage_metric_catalog (
  code text PRIMARY KEY,
  display_name text NOT NULL,
  unit text NOT NULL CHECK (unit IN (
    'count','seats','bytes','calls','reports','work_items','minutes','sessions'
  )),
  aggregation text NOT NULL CHECK (aggregation IN ('sum','max','unique_set')),
  description text NOT NULL,
  active boolean NOT NULL DEFAULT true
);

INSERT INTO portal_usage_metric_catalog (code, display_name, unit, aggregation, description) VALUES
  ('users.seats', 'User seats', 'seats', 'max', 'Concurrent entitled portal/user seats for the tenant.'),
  ('contractor.seats', 'Contractor seats', 'seats', 'max', 'Entitled contractor membership seats.'),
  ('work_items.period', 'Work items per period', 'work_items', 'sum', 'Work packages / tickets counted in the billing period.'),
  ('reports.period', 'Reports per period', 'reports', 'sum', 'Portal report runs generated in the billing period.'),
  ('api.calls.period', 'API calls per period', 'calls', 'sum', 'Authenticated API invocations attributed to the tenant.'),
  ('gis.queries.period', 'GIS queries per period', 'calls', 'sum', 'GIS/spatial queries attributed to the tenant.'),
  ('optical.analysis.period', 'Optical analyses per period', 'count', 'sum', 'Optical assurance / OTDR analysis runs.'),
  ('storage.bytes', 'Object storage bytes', 'bytes', 'max', 'Peak stored object bytes attributed to the tenant.')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Plan entitlements (what a published plan grants)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portal_plan_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES portal_plan_catalog(id) ON DELETE CASCADE,
  metric_code text NOT NULL REFERENCES portal_usage_metric_catalog(code) ON DELETE RESTRICT,
  limit_value bigint CHECK (limit_value IS NULL OR limit_value >= 0),
  -- NULL limit_value = unlimited for that metric
  soft_warn_ratio numeric(5,4) CHECK (soft_warn_ratio IS NULL OR (soft_warn_ratio > 0 AND soft_warn_ratio < 1)),
  hard_enforce boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, metric_code)
);

CREATE INDEX IF NOT EXISTS idx_portal_plan_entitlements_plan
  ON portal_plan_entitlements (plan_id);

-- ---------------------------------------------------------------------------
-- 3. Append-only usage ledger (server-measured only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portal_usage_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  metric_code text NOT NULL REFERENCES portal_usage_metric_catalog(code) ON DELETE RESTRICT,
  delta bigint NOT NULL CHECK (delta <> 0),
  -- positive consumption; negative only for explicit reversals with reason
  period_key text NOT NULL,
  -- e.g. 2026-10 for monthly, 2026-W41 for weekly, 2026 for yearly
  source_kind text NOT NULL CHECK (source_kind IN (
    'api','report','work_item','membership','gis','optical','storage','system_reversal'
  )),
  source_ref text,
  actor_id uuid,
  idempotency_key text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_portal_usage_ledger_tenant_metric_period
  ON portal_usage_ledger (tenant_id, metric_code, period_key, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_portal_usage_ledger_tenant_time
  ON portal_usage_ledger (tenant_id, occurred_at DESC);

ALTER TABLE portal_usage_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_usage_ledger FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portal_usage_ledger_tenant ON portal_usage_ledger;
CREATE POLICY portal_usage_ledger_tenant ON portal_usage_ledger
  FOR ALL
  USING (tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid)
  WITH CHECK (tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid);

-- fiberos_app read/insert under session; no update/delete (append-only)
DROP POLICY IF EXISTS portal_usage_ledger_app_read ON portal_usage_ledger;
CREATE POLICY portal_usage_ledger_app_read ON portal_usage_ledger
  FOR SELECT TO fiberos_app
  USING (tenant_id = NULLIF(current_setting('request.jwt.claim.tenant_id', true), '')::uuid
     OR tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid);

DROP POLICY IF EXISTS portal_usage_ledger_app_insert ON portal_usage_ledger;
CREATE POLICY portal_usage_ledger_app_insert ON portal_usage_ledger
  FOR INSERT TO fiberos_app
  WITH CHECK (tenant_id = NULLIF(current_setting('request.jwt.claim.tenant_id', true), '')::uuid
     OR tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid);

CREATE OR REPLACE FUNCTION public.fiberos_portal_usage_ledger_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PORTAL_USAGE_LEDGER_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS trg_portal_usage_ledger_immutable ON portal_usage_ledger;
CREATE TRIGGER trg_portal_usage_ledger_immutable
  BEFORE UPDATE OR DELETE ON portal_usage_ledger
  FOR EACH ROW EXECUTE FUNCTION public.fiberos_portal_usage_ledger_immutable();

GRANT SELECT, INSERT ON portal_usage_ledger TO fiberos_app;
GRANT SELECT ON portal_usage_metric_catalog TO fiberos_app, authenticated;
GRANT SELECT ON portal_plan_entitlements TO fiberos_app, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Customer service / order management skeleton
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portal_service_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  order_type text NOT NULL CHECK (order_type IN (
    'SERVICE_REQUEST','INSTALLATION','MAINTENANCE','UPGRADE','DOWNGRADE',
    'RELOCATION','NEW_CIRCUIT','CAPACITY','PLANNED_MAINTENANCE',
    'EMERGENCY_INCIDENT','CONTRACTOR_WORK'
  )),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','submitted','accepted','in_progress','awaiting_acceptance',
    'accepted_closed','rejected','cancelled'
  )),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical','emergency')),
  service_id uuid REFERENCES services(id) ON DELETE SET NULL,
  customer_ref text,
  title text NOT NULL,
  description text,
  work_type_code text REFERENCES portal_work_type_catalog(code) ON DELETE SET NULL,
  requested_by uuid,
  assigned_crew_ref text,
  linked_ticket_id uuid,
  linked_work_package_id uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  accepted_at timestamptz,
  closed_at timestamptz,
  idempotency_key text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_portal_service_orders_tenant_status
  ON portal_service_orders (tenant_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_service_orders_tenant_type
  ON portal_service_orders (tenant_id, order_type, requested_at DESC);

CREATE TABLE IF NOT EXISTS portal_service_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES portal_service_orders(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  actor_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_idempotency_key text NOT NULL,
  UNIQUE (tenant_id, event_idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_portal_service_order_events_order
  ON portal_service_order_events (tenant_id, order_id, occurred_at);

ALTER TABLE portal_service_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_service_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE portal_service_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_service_order_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portal_service_orders_tenant ON portal_service_orders;
CREATE POLICY portal_service_orders_tenant ON portal_service_orders
  FOR ALL
  USING (tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid)
  WITH CHECK (tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid);

DROP POLICY IF EXISTS portal_service_order_events_tenant ON portal_service_order_events;
CREATE POLICY portal_service_order_events_tenant ON portal_service_order_events
  FOR ALL
  USING (tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid)
  WITH CHECK (tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid);

DROP POLICY IF EXISTS portal_service_orders_app ON portal_service_orders;
CREATE POLICY portal_service_orders_app ON portal_service_orders
  FOR ALL TO fiberos_app
  USING (tenant_id = NULLIF(current_setting('request.jwt.claim.tenant_id', true), '')::uuid
     OR tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('request.jwt.claim.tenant_id', true), '')::uuid
     OR tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid);

DROP POLICY IF EXISTS portal_service_order_events_app ON portal_service_order_events;
CREATE POLICY portal_service_order_events_app ON portal_service_order_events
  FOR ALL TO fiberos_app
  USING (tenant_id = NULLIF(current_setting('request.jwt.claim.tenant_id', true), '')::uuid
     OR tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('request.jwt.claim.tenant_id', true), '')::uuid
     OR tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid);

CREATE OR REPLACE FUNCTION public.fiberos_portal_service_order_events_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PORTAL_SERVICE_ORDER_EVENTS_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS trg_portal_service_order_events_immutable ON portal_service_order_events;
CREATE TRIGGER trg_portal_service_order_events_immutable
  BEFORE UPDATE OR DELETE ON portal_service_order_events
  FOR EACH ROW EXECUTE FUNCTION public.fiberos_portal_service_order_events_immutable();

GRANT SELECT, INSERT, UPDATE ON portal_service_orders TO fiberos_app;
GRANT SELECT, INSERT ON portal_service_order_events TO fiberos_app;

-- ---------------------------------------------------------------------------
-- 5. SLA contract entity (clocks from documented events only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portal_sla_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code text NOT NULL,
  display_name text NOT NULL,
  service_class text NOT NULL DEFAULT 'standard',
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical','emergency')),
  response_minutes integer CHECK (response_minutes IS NULL OR response_minutes > 0),
  restore_minutes integer CHECK (restore_minutes IS NULL OR restore_minutes > 0),
  resolution_minutes integer CHECK (resolution_minutes IS NULL OR resolution_minutes > 0),
  availability_target_pct numeric(6,3) CHECK (
    availability_target_pct IS NULL OR (availability_target_pct > 0 AND availability_target_pct <= 100)
  ),
  business_hours_only boolean NOT NULL DEFAULT false,
  holiday_calendar_ref text,
  escalation_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  penalty_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  measurement_source text NOT NULL DEFAULT 'database_events'
    CHECK (measurement_source IN ('database_events','nms_poll','field_evidence')),
  evidence_required text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS portal_sla_clock_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  contract_id uuid NOT NULL REFERENCES portal_sla_contracts(id) ON DELETE RESTRICT,
  subject_type text NOT NULL CHECK (subject_type IN ('ticket','service_order','incident','service')),
  subject_id uuid NOT NULL,
  clock_kind text NOT NULL CHECK (clock_kind IN ('detected','responded','restored','resolved')),
  occurred_at timestamptz NOT NULL,
  evidence_class text NOT NULL CHECK (evidence_class IN (
    'observed','measured','derived','declared','unverified'
  )),
  source_ref text,
  actor_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_portal_sla_clock_events_subject
  ON portal_sla_clock_events (tenant_id, subject_type, subject_id, clock_kind, occurred_at);

ALTER TABLE portal_sla_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_sla_contracts FORCE ROW LEVEL SECURITY;
ALTER TABLE portal_sla_clock_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_sla_clock_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portal_sla_contracts_tenant ON portal_sla_contracts;
CREATE POLICY portal_sla_contracts_tenant ON portal_sla_contracts
  FOR ALL
  USING (tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid)
  WITH CHECK (tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid);

DROP POLICY IF EXISTS portal_sla_clock_events_tenant ON portal_sla_clock_events;
CREATE POLICY portal_sla_clock_events_tenant ON portal_sla_clock_events
  FOR ALL
  USING (tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid)
  WITH CHECK (tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid);

DROP POLICY IF EXISTS portal_sla_contracts_app ON portal_sla_contracts;
CREATE POLICY portal_sla_contracts_app ON portal_sla_contracts
  FOR ALL TO fiberos_app
  USING (tenant_id = NULLIF(current_setting('request.jwt.claim.tenant_id', true), '')::uuid
     OR tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('request.jwt.claim.tenant_id', true), '')::uuid
     OR tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid);

DROP POLICY IF EXISTS portal_sla_clock_events_app ON portal_sla_clock_events;
CREATE POLICY portal_sla_clock_events_app ON portal_sla_clock_events
  FOR ALL TO fiberos_app
  USING (tenant_id = NULLIF(current_setting('request.jwt.claim.tenant_id', true), '')::uuid
     OR tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('request.jwt.claim.tenant_id', true), '')::uuid
     OR tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid);

CREATE OR REPLACE FUNCTION public.fiberos_portal_sla_clock_events_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PORTAL_SLA_CLOCK_EVENTS_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS trg_portal_sla_clock_events_immutable ON portal_sla_clock_events;
CREATE TRIGGER trg_portal_sla_clock_events_immutable
  BEFORE UPDATE OR DELETE ON portal_sla_clock_events
  FOR EACH ROW EXECUTE FUNCTION public.fiberos_portal_sla_clock_events_immutable();

GRANT SELECT, INSERT, UPDATE ON portal_sla_contracts TO fiberos_app;
GRANT SELECT, INSERT ON portal_sla_clock_events TO fiberos_app;

COMMIT;
