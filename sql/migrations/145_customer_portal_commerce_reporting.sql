-- R14.1 commercial customer portal + multi-frequency subscriptions + governed reporting.
-- Source implementation only. Payment/email provider infrastructure remains buyer/seller configured.
BEGIN;

CREATE TABLE IF NOT EXISTS portal_work_type_catalog (
  code text PRIMARY KEY,
  display_name text NOT NULL,
  discipline text NOT NULL,
  summary text NOT NULL,
  required_evidence text[] NOT NULL DEFAULT '{}',
  standards jsonb NOT NULL DEFAULT '[]'::jsonb,
  feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS portal_plan_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  work_type_code text NOT NULL REFERENCES portal_work_type_catalog(code) ON DELETE RESTRICT,
  billing_interval text NOT NULL CHECK (billing_interval IN ('weekly','monthly','yearly')),
  display_name text NOT NULL,
  summary text NOT NULL,
  currency char(3),
  amount_minor bigint CHECK (amount_minor IS NULL OR amount_minor >= 0),
  quote_required boolean NOT NULL DEFAULT true,
  seat_limit integer CHECK (seat_limit IS NULL OR seat_limit > 0),
  work_item_limit integer CHECK (work_item_limit IS NULL OR work_item_limit > 0),
  feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  published boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((quote_required = true AND amount_minor IS NULL) OR (quote_required = false AND amount_minor IS NOT NULL AND currency IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS portal_tenant_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  portal_role text NOT NULL CHECK (portal_role IN (
    'owner','admin','operations','engineering','quality','billing','viewer',
    'contractor_manager','contractor_supervisor','contractor_field'
  )),
  work_type_scope text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS portal_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES portal_plan_catalog(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','paused','past_due','cancelled','expired')),
  payment_state text NOT NULL DEFAULT 'quote_required' CHECK (payment_state IN ('quote_required','pending_external_checkout','invoiced','paid','failed')),
  billing_interval text NOT NULL CHECK (billing_interval IN ('weekly','monthly','yearly')),
  currency char(3),
  amount_minor bigint CHECK (amount_minor IS NULL OR amount_minor >= 0),
  started_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  auto_renew boolean NOT NULL DEFAULT true,
  provider text,
  provider_subscription_ref text,
  idempotency_key text NOT NULL,
  cancellation_at timestamptz,
  cancellation_reason text,
  created_by uuid,
  updated_by uuid,
  version bigint NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  CHECK ((amount_minor IS NULL AND currency IS NULL) OR (amount_minor IS NOT NULL AND currency ~ '^[A-Z]{3}$'))
);
DROP INDEX IF EXISTS portal_one_live_subscription_per_tenant;
CREATE UNIQUE INDEX IF NOT EXISTS portal_one_live_subscription_per_plan
  ON portal_subscriptions (tenant_id, plan_id)
  WHERE status IN ('pending','active','paused','past_due');

CREATE TABLE IF NOT EXISTS portal_subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  subscription_id uuid NOT NULL REFERENCES portal_subscriptions(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'created','checkout_requested','activated','paused','resumed','plan_changed',
    'renewal_toggled','cancelled','expired','payment_failed','payment_confirmed'
  )),
  event_idempotency_key text NOT NULL,
  actor_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, event_idempotency_key)
);
CREATE INDEX IF NOT EXISTS portal_subscription_events_tenant_time
  ON portal_subscription_events (tenant_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS portal_report_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  requested_by uuid,
  schedule_id uuid,
  report_type text NOT NULL CHECK (report_type IN ('executive','network','quality','field','financial','engineering')),
  report_format text NOT NULL DEFAULT 'json' CHECK (report_format IN ('json','csv')),
  status text NOT NULL DEFAULT 'generated' CHECK (status IN ('queued','generating','generated','failed')),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  generated_at timestamptz,
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  report_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  rendered_csv text,
  content_sha256 char(64),
  outbox_event_id uuid,
  idempotency_key text NOT NULL,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (period_start < period_end),
  CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[a-f0-9]{64}$')
);
CREATE INDEX IF NOT EXISTS portal_report_runs_tenant_time
  ON portal_report_runs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS portal_report_runs_schedule_time
  ON portal_report_runs (schedule_id, created_at DESC);

CREATE TABLE IF NOT EXISTS portal_report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  created_by uuid,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  report_type text NOT NULL CHECK (report_type IN ('executive','network','quality','field','financial','engineering')),
  report_format text NOT NULL DEFAULT 'csv' CHECK (report_format IN ('json','csv')),
  cadence text NOT NULL CHECK (cadence IN ('weekly','monthly','yearly')),
  weekday smallint,
  day_of_month smallint,
  month_of_year smallint,
  hour smallint NOT NULL DEFAULT 8 CHECK (hour BETWEEN 0 AND 23),
  minute smallint NOT NULL DEFAULT 0 CHECK (minute BETWEEN 0 AND 59),
  timezone text NOT NULL DEFAULT 'UTC',
  recipients text[] NOT NULL,
  active boolean NOT NULL DEFAULT true,
  next_run_at timestamptz NOT NULL,
  last_run_at timestamptz,
  last_error text,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (cardinality(recipients) BETWEEN 1 AND 10),
  CHECK (
    (cadence = 'weekly' AND weekday BETWEEN 0 AND 6 AND day_of_month IS NULL AND month_of_year IS NULL)
    OR
    (cadence = 'monthly' AND weekday IS NULL AND day_of_month BETWEEN 1 AND 31 AND month_of_year IS NULL)
    OR
    (cadence = 'yearly' AND weekday IS NULL AND day_of_month BETWEEN 1 AND 31 AND month_of_year BETWEEN 1 AND 12)
  )
);
CREATE INDEX IF NOT EXISTS portal_report_schedules_due
  ON portal_report_schedules (active, next_run_at)
  WHERE active = true;

CREATE OR REPLACE FUNCTION fiberos_portal_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION fiberos_portal_touch_updated_at() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_portal_plan_updated_at ON portal_plan_catalog;
CREATE TRIGGER trg_portal_plan_updated_at BEFORE UPDATE ON portal_plan_catalog
FOR EACH ROW EXECUTE FUNCTION fiberos_portal_touch_updated_at();
DROP TRIGGER IF EXISTS trg_portal_membership_updated_at ON portal_tenant_memberships;
CREATE TRIGGER trg_portal_membership_updated_at BEFORE UPDATE ON portal_tenant_memberships
FOR EACH ROW EXECUTE FUNCTION fiberos_portal_touch_updated_at();
DROP TRIGGER IF EXISTS trg_portal_subscription_updated_at ON portal_subscriptions;
CREATE TRIGGER trg_portal_subscription_updated_at BEFORE UPDATE ON portal_subscriptions
FOR EACH ROW EXECUTE FUNCTION fiberos_portal_touch_updated_at();
DROP TRIGGER IF EXISTS trg_portal_report_run_updated_at ON portal_report_runs;
CREATE TRIGGER trg_portal_report_run_updated_at BEFORE UPDATE ON portal_report_runs
FOR EACH ROW EXECUTE FUNCTION fiberos_portal_touch_updated_at();
DROP TRIGGER IF EXISTS trg_portal_report_schedule_updated_at ON portal_report_schedules;
CREATE TRIGGER trg_portal_report_schedule_updated_at BEFORE UPDATE ON portal_report_schedules
FOR EACH ROW EXECUTE FUNCTION fiberos_portal_touch_updated_at();

-- Subscription/report event history is append-only.
CREATE OR REPLACE FUNCTION fiberos_portal_block_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'PORTAL_HISTORY_APPEND_ONLY';
END;
$$;
REVOKE ALL ON FUNCTION fiberos_portal_block_history_mutation() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_portal_subscription_events_immutable ON portal_subscription_events;
CREATE TRIGGER trg_portal_subscription_events_immutable
BEFORE UPDATE OR DELETE ON portal_subscription_events
FOR EACH ROW EXECUTE FUNCTION fiberos_portal_block_history_mutation();

-- Seed the standards/work-type catalog; these are reference definitions, not operational data.
INSERT INTO portal_work_type_catalog(code,display_name,discipline,summary,required_evidence,standards,feature_flags,sort_order)
VALUES
('operator-enterprise','Telecom Operator Enterprise','network-operations','Carrier-scale service, network, SLA, capacity and assurance control.',
 ARRAY['topology_identity','service_path','telemetry_or_measurement','incident_trace'],
 '[{"ref":"ITU-T G.9804.1","edition":"2019 Amd.3 05/2025","status":"in_force"},{"ref":"ITU-T G.9804.3","edition":"2021 Amd.3 02/2026","status":"in_force"},{"ref":"ITU-T G.9807.1","edition":"2023 Amd.1 05/2025","status":"in_force"}]'::jsonb,
 '{"networkReality":true,"capacity":true,"sla":true,"assurance":true}'::jsonb,10),
('contractor-general','Fiber Contractor Enterprise','construction','Commercial field delivery with work packages, materials, evidence and acceptance.',
 ARRAY['work_package','gps','photo','quality_gate','material_chain'],
 '[{"ref":"IEC 61280-4-2","edition":"2024","status":"current"},{"ref":"IEC 61280-4-3","edition":"2022","status":"current"}]'::jsonb,
 '{"workPackages":true,"materialCustody":true,"acceptance":true}'::jsonb,20),
('fusion-splicing','Fusion Splicing & Jointing','fiber-splicing','Splice closure, tray/core traceability, optical loss evidence and QA.',
 ARRAY['splice_identity','photo','optical_measurement','technician_identity','qa_gate'],
 '[{"ref":"IEC 61280-4-2","edition":"2024","status":"current"},{"ref":"IEC 61280-4-3","edition":"2022","status":"current"}]'::jsonb,
 '{"spliceTrace":true,"opticalQa":true,"firstTimeRight":true}'::jsonb,30),
('cabinet-odf','Cabinet / ODF / FDT','outside-plant','Port inventory, patching, capacity, labeling and evidence-controlled changes.',
 ARRAY['asset_identity','port_identity','patch_trace','photo','acceptance'],
 '[{"ref":"ITU-T G.9805","edition":"current recommendation family","status":"in_force"},{"ref":"IEC 61280-4-2","edition":"2024","status":"current"}]'::jsonb,
 '{"portCapacity":true,"physicalTopology":true,"labelAudit":true}'::jsonb,40),
('riser','Building Riser / Vertical Distribution','building-access','Building/riser/floor/unit topology with local fire/building-code overlays.',
 ARRAY['building_identity','riser_identity','floor_mapping','photo','acceptance'],
 '[{"ref":"IEC 61280-4-2","edition":"2024","status":"current"},{"ref":"IEC 61280-4-3","edition":"2022","status":"current"},{"ref":"LOCAL_CODE_OVERLAY","edition":"buyer/jurisdiction","status":"required"}]'::jsonb,
 '{"verticalTopology":true,"buildingEvidence":true,"localCodeOverlay":true}'::jsonb,50),
('installation-activation','Installation & Service Activation','customer-activation','Drop/ONT/router install, measured optical acceptance and NMS/customer acceptance chain.',
 ARRAY['installation_job','optical_test','activation_event','customer_acceptance'],
 '[{"ref":"ITU-T G.9804.1","edition":"2019 Amd.3 05/2025","status":"in_force"},{"ref":"ITU-T G.9804.3","edition":"2021 Amd.3 02/2026","status":"in_force"},{"ref":"IEC 61280-4-3","edition":"2022","status":"current"}]'::jsonb,
 '{"activationGate":true,"customerAcceptance":true,"opticalEvidence":true}'::jsonb,60),
('otdr-testing','OTDR / Optical Test Laboratory','test-assurance','Trace/test data intake with explicit source, instrument and calibration provenance.',
 ARRAY['measurement','instrument_identity','calibration_provenance','test_method'],
 '[{"ref":"IEC 61280-4-2","edition":"2024","status":"current"},{"ref":"IEC 61280-4-3","edition":"2022","status":"current"}]'::jsonb,
 '{"otdr":true,"lspm":true,"provenance":true}'::jsonb,70),
('civil-duct','Civil / Duct / Corridor','civil-outside-plant','Duct, corridor, construction evidence and planned/field/as-built reconciliation.',
 ARRAY['corridor_identity','gps','civil_evidence','as_built_identity'],
 '[{"ref":"LOCAL_CIVIL_CODE","edition":"buyer/jurisdiction","status":"required"}]'::jsonb,
 '{"gisReconciliation":true,"constructionChain":true,"localCodeOverlay":true}'::jsonb,80),
('nms-engineering','NMS / OLT Engineering','nms-assurance','Read-only NMS integration, optical telemetry evidence and engineering diagnostics.',
 ARRAY['asset_identity','telemetry','adapter_provenance','engineering_context'],
 '[{"ref":"ITU-T G.9804.3","edition":"2021 Amd.3 02/2026","status":"in_force"},{"ref":"ITU-T G.9807.1","edition":"2023 Amd.1 05/2025","status":"in_force"}]'::jsonb,
 '{"readOnlyNms":true,"opticalTelemetry":true,"engineeringAssurance":true}'::jsonb,90)
ON CONFLICT(code) DO UPDATE SET
  display_name=excluded.display_name,
  discipline=excluded.discipline,
  summary=excluded.summary,
  required_evidence=excluded.required_evidence,
  standards=excluded.standards,
  feature_flags=excluded.feature_flags,
  active=true,
  sort_order=excluded.sort_order;

INSERT INTO portal_plan_catalog(code,work_type_code,billing_interval,display_name,summary,quote_required,published,active,feature_flags)
SELECT
  w.code || '-' || i.billing_interval,
  w.code,
  i.billing_interval,
  w.display_name || ' — ' || initcap(i.billing_interval),
  w.summary || ' Frequency: ' || i.billing_interval || '.',
  true,
  true,
  true,
  w.feature_flags
FROM portal_work_type_catalog w
CROSS JOIN (VALUES ('weekly'),('monthly'),('yearly')) AS i(billing_interval)
ON CONFLICT(code) DO UPDATE SET
  work_type_code=excluded.work_type_code,
  billing_interval=excluded.billing_interval,
  display_name=excluded.display_name,
  summary=excluded.summary,
  feature_flags=excluded.feature_flags,
  published=true,
  active=true;

-- Harden all tenant-sensitive portal state.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'portal_tenant_memberships',
    'portal_subscriptions',
    'portal_subscription_events',
    'portal_report_runs',
    'portal_report_schedules'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  END LOOP;
END $$;

ALTER TABLE portal_work_type_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_plan_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portal_work_type_read_authenticated ON portal_work_type_catalog;
CREATE POLICY portal_work_type_read_authenticated ON portal_work_type_catalog
FOR SELECT TO authenticated USING (active = true);

DROP POLICY IF EXISTS portal_work_type_read_app ON portal_work_type_catalog;
CREATE POLICY portal_work_type_read_app ON portal_work_type_catalog
FOR SELECT TO fiberos_app USING (active = true);

DROP POLICY IF EXISTS portal_plan_read_authenticated ON portal_plan_catalog;
CREATE POLICY portal_plan_read_authenticated ON portal_plan_catalog
FOR SELECT TO authenticated USING (published = true AND active = true);

DROP POLICY IF EXISTS portal_plan_read_app ON portal_plan_catalog;
CREATE POLICY portal_plan_read_app ON portal_plan_catalog
FOR SELECT TO fiberos_app USING (published = true AND active = true);

DROP POLICY IF EXISTS portal_plan_admin_app ON portal_plan_catalog;
CREATE POLICY portal_plan_admin_app ON portal_plan_catalog
FOR UPDATE TO fiberos_app
USING (fiberos_has_any_role(ARRAY['exec','cfo','sysadmin']))
WITH CHECK (fiberos_has_any_role(ARRAY['exec','cfo','sysadmin']));

DROP POLICY IF EXISTS portal_membership_select_auth ON portal_tenant_memberships;
CREATE POLICY portal_membership_select_auth ON portal_tenant_memberships
FOR SELECT TO authenticated USING (fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS portal_membership_select_app ON portal_tenant_memberships;
CREATE POLICY portal_membership_select_app ON portal_tenant_memberships
FOR SELECT TO fiberos_app USING (fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS portal_membership_write_app ON portal_tenant_memberships;
CREATE POLICY portal_membership_write_app ON portal_tenant_memberships
FOR INSERT TO fiberos_app
WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id) AND fiberos_has_any_role(ARRAY['exec','sysadmin','ops_manager']));
CREATE POLICY portal_membership_update_app ON portal_tenant_memberships
FOR UPDATE TO fiberos_app
USING (fiberos_enterprise_tenant_ok(tenant_id) AND fiberos_has_any_role(ARRAY['exec','sysadmin','ops_manager']))
WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id) AND fiberos_has_any_role(ARRAY['exec','sysadmin','ops_manager']));

DROP POLICY IF EXISTS portal_subscription_select_auth ON portal_subscriptions;
CREATE POLICY portal_subscription_select_auth ON portal_subscriptions
FOR SELECT TO authenticated USING (fiberos_enterprise_tenant_ok(tenant_id));
DROP POLICY IF EXISTS portal_subscription_select_app ON portal_subscriptions;
CREATE POLICY portal_subscription_select_app ON portal_subscriptions
FOR SELECT TO fiberos_app USING (fiberos_enterprise_tenant_ok(tenant_id));
DROP POLICY IF EXISTS portal_subscription_insert_app ON portal_subscriptions;
CREATE POLICY portal_subscription_insert_app ON portal_subscriptions
FOR INSERT TO fiberos_app
WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id));
DROP POLICY IF EXISTS portal_subscription_update_app ON portal_subscriptions;
CREATE POLICY portal_subscription_update_app ON portal_subscriptions
FOR UPDATE TO fiberos_app
USING (fiberos_enterprise_tenant_ok(tenant_id))
WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS portal_subscription_events_select_auth ON portal_subscription_events;
CREATE POLICY portal_subscription_events_select_auth ON portal_subscription_events
FOR SELECT TO authenticated USING (fiberos_enterprise_tenant_ok(tenant_id));
DROP POLICY IF EXISTS portal_subscription_events_select_app ON portal_subscription_events;
CREATE POLICY portal_subscription_events_select_app ON portal_subscription_events
FOR SELECT TO fiberos_app USING (fiberos_enterprise_tenant_ok(tenant_id));
DROP POLICY IF EXISTS portal_subscription_events_insert_app ON portal_subscription_events;
CREATE POLICY portal_subscription_events_insert_app ON portal_subscription_events
FOR INSERT TO fiberos_app
WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS portal_report_runs_select_auth ON portal_report_runs;
CREATE POLICY portal_report_runs_select_auth ON portal_report_runs
FOR SELECT TO authenticated USING (fiberos_enterprise_tenant_ok(tenant_id));
DROP POLICY IF EXISTS portal_report_runs_select_app ON portal_report_runs;
CREATE POLICY portal_report_runs_select_app ON portal_report_runs
FOR SELECT TO fiberos_app USING (fiberos_enterprise_tenant_ok(tenant_id));
DROP POLICY IF EXISTS portal_report_runs_insert_app ON portal_report_runs;
CREATE POLICY portal_report_runs_insert_app ON portal_report_runs
FOR INSERT TO fiberos_app WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id));
DROP POLICY IF EXISTS portal_report_runs_update_app ON portal_report_runs;
CREATE POLICY portal_report_runs_update_app ON portal_report_runs
FOR UPDATE TO fiberos_app USING (fiberos_enterprise_tenant_ok(tenant_id))
WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS portal_report_schedule_select_auth ON portal_report_schedules;
CREATE POLICY portal_report_schedule_select_auth ON portal_report_schedules
FOR SELECT TO authenticated USING (fiberos_enterprise_tenant_ok(tenant_id));
DROP POLICY IF EXISTS portal_report_schedule_select_app ON portal_report_schedules;
CREATE POLICY portal_report_schedule_select_app ON portal_report_schedules
FOR SELECT TO fiberos_app USING (fiberos_enterprise_tenant_ok(tenant_id));
DROP POLICY IF EXISTS portal_report_schedule_insert_app ON portal_report_schedules;
CREATE POLICY portal_report_schedule_insert_app ON portal_report_schedules
FOR INSERT TO fiberos_app WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id));
DROP POLICY IF EXISTS portal_report_schedule_update_app ON portal_report_schedules;
CREATE POLICY portal_report_schedule_update_app ON portal_report_schedules
FOR UPDATE TO fiberos_app USING (fiberos_enterprise_tenant_ok(tenant_id))
WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id));

GRANT SELECT ON portal_work_type_catalog, portal_plan_catalog TO authenticated, fiberos_app;
GRANT SELECT ON portal_tenant_memberships, portal_subscriptions, portal_subscription_events, portal_report_runs, portal_report_schedules TO authenticated;
GRANT SELECT, INSERT, UPDATE ON portal_tenant_memberships, portal_subscriptions, portal_subscription_events, portal_report_runs, portal_report_schedules TO fiberos_app;
GRANT UPDATE ON portal_plan_catalog TO fiberos_app;



-- Canonical tenant-scoped report compiler. It reads persisted facts only and
-- never fabricates uptime, speed, telemetry, quality or financial values.
CREATE OR REPLACE FUNCTION fiberos_portal_report(
  p_tenant_id uuid,
  p_report_type text,
  p_period_start timestamptz,
  p_period_end timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_current_tenant uuid;
  v_type text := lower(trim(p_report_type));
  v_tenant jsonb;
  v_operations jsonb;
  v_network jsonb;
  v_quality jsonb;
  v_field jsonb;
  v_financial jsonb;
  v_engineering jsonb;
BEGIN
  IF p_tenant_id IS NULL OR p_period_start IS NULL OR p_period_end IS NULL OR p_period_start >= p_period_end THEN
    RAISE EXCEPTION 'PORTAL_REPORT_INPUT_INVALID';
  END IF;
  IF p_period_end > p_period_start + interval '366 days' THEN
    RAISE EXCEPTION 'PORTAL_REPORT_WINDOW_TOO_LARGE';
  END IF;
  IF v_type NOT IN ('executive','network','quality','field','financial','engineering') THEN
    RAISE EXCEPTION 'PORTAL_REPORT_TYPE_INVALID';
  END IF;

  IF current_user IN ('authenticated','fiberos_app') THEN
    SELECT up.tenant_id INTO v_current_tenant
    FROM public.user_preferences up
    WHERE up.user_id = auth.uid()
    LIMIT 1;
    IF v_current_tenant IS NULL OR v_current_tenant <> p_tenant_id THEN
      RAISE EXCEPTION 'TENANT_CONTEXT_REQUIRED';
    END IF;
  END IF;

  SELECT jsonb_build_object(
    'tenantId', t.id,
    'tenantName', t.name,
    'locale', t.default_locale,
    'timezone', t.timezone,
    'currency', t.currency
  ) INTO v_tenant
  FROM public.tenants t
  WHERE t.id = p_tenant_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND';
  END IF;

  SELECT jsonb_build_object(
    'services', (
      SELECT jsonb_build_object(
        'total', count(*)::int,
        'active', count(*) FILTER (WHERE s.is_active)::int,
        'declaredSpeedMaxMbps',
          max(
            CASE
              WHEN (s.asset_path->>'serviceSpeedMbps') ~ '^[0-9]+(\\.[0-9]+)?$'
                THEN (s.asset_path->>'serviceSpeedMbps')::numeric
              WHEN (s.asset_path->>'downstreamMbps') ~ '^[0-9]+(\\.[0-9]+)?$'
                THEN (s.asset_path->>'downstreamMbps')::numeric
              ELSE NULL
            END
          )
      ) FROM public.services s WHERE s.tenant_id = p_tenant_id
    ),
    'tickets', (
      SELECT jsonb_build_object(
        'opened', count(*) FILTER (WHERE t.created_at >= p_period_start AND t.created_at < p_period_end)::int,
        'openBacklog', count(*) FILTER (WHERE t.status IN ('pending','in_progress','awaiting_evidence','manager_review'))::int,
        'completed', count(*) FILTER (
          WHERE t.status = 'completed' AND t.closed_at >= p_period_start AND t.closed_at < p_period_end
        )::int,
        'overdueSla', count(*) FILTER (
          WHERE t.sla_deadline IS NOT NULL AND t.sla_deadline < now()
            AND t.status NOT IN ('completed','cancelled','rejected')
        )::int
      ) FROM public.tickets t WHERE t.tenant_id = p_tenant_id
    ),
    'incidents', (
      SELECT jsonb_build_object(
        'active', count(*) FILTER (WHERE i.state NOT IN ('resolved','closed'))::int,
        'critical', count(*) FILTER (WHERE i.state NOT IN ('resolved','closed') AND i.severity = 'P1')::int,
        'openedInWindow', count(*) FILTER (WHERE i.created_at >= p_period_start AND i.created_at < p_period_end)::int
      ) FROM public.incidents i WHERE i.tenant_id = p_tenant_id
    )
  ) INTO v_operations;

  SELECT jsonb_build_object(
    'assets', (
      SELECT jsonb_build_object(
        'total', count(*)::int,
        'overCapacity', count(*) FILTER (WHERE coalesce(c.over_capacity,false))::int,
        'avgUtilizationPct', round(coalesce(avg(c.utilization_pct),0),2)
      )
      FROM public.pon_capacity_intelligence c
      WHERE c.tenant_id = p_tenant_id
    ),
    'telemetry', (
      SELECT jsonb_build_object(
        'total', count(*)::int,
        'observedOrMeasured', count(*) FILTER (WHERE evidence_class IN ('observed','measured'))::int,
        'lastObservedAt', max(observed_at),
        'lossOfSignalEvents', count(*) FILTER (WHERE signal_type='los' AND value_text IN ('true','1','on'))::int,
        'rxPowerSamples', count(*) FILTER (WHERE signal_type='rx_power' AND value_numeric IS NOT NULL)::int,
        'latestRxPowerDbm', (
          SELECT o.value_numeric
          FROM public.network_pon_telemetry_observations o
          WHERE o.tenant_id=p_tenant_id AND o.signal_type='rx_power' AND o.value_numeric IS NOT NULL
          ORDER BY o.observed_at DESC, o.id DESC LIMIT 1
        )
      )
      FROM public.network_pon_telemetry_observations o
      WHERE o.tenant_id = p_tenant_id
        AND o.observed_at >= p_period_start AND o.observed_at < p_period_end
    )
  ) INTO v_network;

  SELECT jsonb_build_object(
    'firstTimeFix', (
      SELECT jsonb_build_object(
        'trackedCompleted', count(*) FILTER (WHERE status='completed' AND reopen_tracking_observed)::int,
        'trackedReopened', count(*) FILTER (WHERE status='completed' AND reopen_tracking_observed AND reopened_at IS NOT NULL)::int,
        'ratePct', CASE
          WHEN count(*) FILTER (WHERE status='completed' AND reopen_tracking_observed) = 0 THEN NULL
          ELSE round(
            100.0 * count(*) FILTER (WHERE status='completed' AND reopen_tracking_observed AND reopened_at IS NULL)
            / count(*) FILTER (WHERE status='completed' AND reopen_tracking_observed), 2
          )
        END
      )
      FROM public.tickets
      WHERE tenant_id=p_tenant_id AND closed_at >= p_period_start AND closed_at < p_period_end
    ),
    'qualityGates', (
      SELECT jsonb_build_object(
        'pending', count(*) FILTER (WHERE status='pending')::int,
        'passed', count(*) FILTER (WHERE status='passed')::int,
        'failed', count(*) FILTER (WHERE status='failed')::int,
        'waived', count(*) FILTER (WHERE status='waived')::int
      ) FROM public.ftth_quality_gates
      WHERE tenant_id=p_tenant_id
    ),
    'acceptedWorkPackages', (
      SELECT count(*) FILTER (WHERE status='accepted')::int
      FROM public.ftth_work_packages WHERE tenant_id=p_tenant_id
    )
  ) INTO v_quality;

  SELECT jsonb_build_object(
    'workPackages', (
      SELECT jsonb_build_object(
        'total', count(*)::int,
        'active', count(*) FILTER (WHERE status IN ('assigned','in_progress','blocked','submitted','qc_pending','rework'))::int,
        'acceptedInWindow', count(*) FILTER (WHERE status='accepted' AND actual_end >= p_period_start AND actual_end < p_period_end)::int,
        'rework', count(*) FILTER (WHERE status='rework')::int
      ) FROM public.ftth_work_packages
      WHERE tenant_id=p_tenant_id
    ),
    'byWorkType', (
      SELECT coalesce(jsonb_agg(x ORDER BY x.work_type),'[]'::jsonb)
      FROM (
        SELECT work_type, count(*)::int count
        FROM public.ftth_work_packages
        WHERE tenant_id=p_tenant_id
        GROUP BY work_type
      ) x
    ),
    'contractors', (
      SELECT jsonb_build_object(
        'active', count(*) FILTER (WHERE status='active')::int,
        'qualified', count(*) FILTER (WHERE status IN ('qualified','active'))::int
      ) FROM public.contractor_entities WHERE tenant_id=p_tenant_id
    ),
    'measuredWork', (
      SELECT jsonb_build_object(
        'observations', count(*)::int,
        'quantity', coalesce(sum(quantity),0),
        'amountMinor', coalesce(sum(quantity*rate_minor),0)
      )
      FROM public.contractor_work_measurements
      WHERE tenant_id=p_tenant_id
        AND status IN ('verified','approved','invoiced','paid')
        AND measured_at >= p_period_start AND measured_at < p_period_end
    )
  ) INTO v_field;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'currency', x.currency,
      'issued', x.issued::int,
      'paid', x.paid::int,
      'overdue', x.overdue::int,
      'issuedAmountMinor', x.issued_amount_minor,
      'paidAmountMinor', x.paid_amount_minor,
      'overdueAmountMinor', x.overdue_amount_minor
    ) ORDER BY x.currency
  ), '[]'::jsonb) INTO v_financial
  FROM (
    SELECT
      currency,
      count(*) FILTER (WHERE status IN ('issued','overdue','partially_paid')) issued,
      count(*) FILTER (WHERE status='paid') paid,
      count(*) FILTER (WHERE status='overdue') overdue,
      coalesce(sum(amount_minor) FILTER (WHERE status IN ('issued','overdue','partially_paid')),0) issued_amount_minor,
      coalesce(sum(amount_minor) FILTER (WHERE status='paid'),0) paid_amount_minor,
      coalesce(sum(amount_minor) FILTER (WHERE status='overdue'),0) overdue_amount_minor
    FROM public.invoices
    WHERE tenant_id=p_tenant_id
      AND created_at >= p_period_start AND created_at < p_period_end
    GROUP BY currency
  ) x;

  SELECT jsonb_build_object(
    'opticalMeasurements', (
      SELECT jsonb_build_object(
        'samples', count(*)::int,
        'fieldOrNms', count(*) FILTER (WHERE source IN ('field_reading','nms_poll'))::int,
        'lastMeasuredAt', max(measured_at)
      ) FROM public.optical_measurements
      WHERE tenant_id=p_tenant_id AND measured_at >= p_period_start AND measured_at < p_period_end
    ),
    'pathBoundAssurance', (
      SELECT jsonb_build_object(
        'assessments', count(*)::int,
        'pathBound', count(*) FILTER (WHERE path_bound)::int,
        'withCurrentRx', count(*) FILTER (WHERE current_rx_dbm IS NOT NULL)::int
      ) FROM public.network_optical_assurance_assessments
      WHERE tenant_id=p_tenant_id
        AND created_at >= p_period_start AND created_at < p_period_end
    ),
    'standardsModel', jsonb_build_object(
      'portalCatalogVersion','2026-10-08',
      'currentReferences', jsonb_build_array(
        jsonb_build_object('ref','ITU-T G.9804.1','edition','2019 Amd.3 05/2025'),
        jsonb_build_object('ref','ITU-T G.9804.3','edition','2021 Amd.3 02/2026'),
        jsonb_build_object('ref','ITU-T G.9807.1','edition','2023 Amd.1 05/2025'),
        jsonb_build_object('ref','IEC 61280-4-2','edition','2024'),
        jsonb_build_object('ref','IEC 61280-4-3','edition','2022')
      )
    )
  ) INTO v_engineering;

  RETURN jsonb_build_object(
    'reportVersion','customer-portal.1',
    'reportType',v_type,
    'generatedAt',now(),
    'periodStart',p_period_start,
    'periodEnd',p_period_end,
    'tenant',v_tenant,
    'operations',v_operations,
    'network',v_network,
    'quality',v_quality,
    'field',v_field,
    'financial',v_financial,
    'engineering',v_engineering,
    'sourceSnapshot',jsonb_build_object(
      'capturedAt',now(),
      'tenantScoped',true,
      'syntheticData',false,
      'authoritativeLayer','POSTGRESQL_PERSISTED_FACTS'
    ),
    'evidencePolicy',jsonb_build_object(
      'unknownValuesPreserved',true,
      'predictionsIncluded',false,
      'autonomousActions',false
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION fiberos_portal_report(uuid,text,timestamptz,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fiberos_portal_report(uuid,text,timestamptz,timestamptz) TO authenticated, fiberos_app, fiberos_worker;



-- Worker boundary: the scheduler is trusted infrastructure, but it has no
-- generic tenant write authority outside these narrow portal/outbox surfaces.
DROP POLICY IF EXISTS portal_report_schedule_worker ON portal_report_schedules;
CREATE POLICY portal_report_schedule_worker ON portal_report_schedules
FOR SELECT TO fiberos_worker
USING (current_user = 'fiberos_worker');
DROP POLICY IF EXISTS portal_report_schedule_worker_update ON portal_report_schedules;
CREATE POLICY portal_report_schedule_worker_update ON portal_report_schedules
FOR UPDATE TO fiberos_worker
USING (current_user = 'fiberos_worker')
WITH CHECK (current_user = 'fiberos_worker');

DROP POLICY IF EXISTS portal_report_run_worker ON portal_report_runs;
CREATE POLICY portal_report_run_worker ON portal_report_runs
FOR INSERT TO fiberos_worker
WITH CHECK (current_user = 'fiberos_worker');

GRANT SELECT, UPDATE ON portal_report_schedules TO fiberos_worker;
GRANT INSERT ON portal_report_runs TO fiberos_worker;

-- Scheduler report execution crosses tenant RLS only through this explicit
-- worker-only authority. The caller cannot be authenticated users.
CREATE OR REPLACE FUNCTION fiberos_portal_worker_report(
  p_tenant_id uuid,
  p_report_type text,
  p_period_start timestamptz,
  p_period_end timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
BEGIN
  IF session_user <> 'fiberos_worker' AND current_user <> 'fiberos_owner' THEN
    RAISE EXCEPTION 'PORTAL_WORKER_AUTHORITY_REQUIRED';
  END IF;
  RETURN fiberos_portal_report(p_tenant_id,p_report_type,p_period_start,p_period_end);
END;
$$;
ALTER FUNCTION fiberos_portal_worker_report(uuid,text,timestamptz,timestamptz) OWNER TO fiberos_owner;
REVOKE ALL ON FUNCTION fiberos_portal_worker_report(uuid,text,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated, fiberos_app;
GRANT EXECUTE ON FUNCTION fiberos_portal_worker_report(uuid,text,timestamptz,timestamptz) TO fiberos_worker;

COMMIT;
