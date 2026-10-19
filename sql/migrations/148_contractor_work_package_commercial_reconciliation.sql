-- 148_contractor_work_package_commercial_reconciliation.sql
-- Bridges Customer Portal orders → FTTH work packages → contractor measurements
-- → invoice reconciliation with Maker/Checker segregation of duties.
--
-- Truth boundaries:
-- - No payment success without external provider evidence.
-- - measured_by cannot approve/verify the same measurement.
-- - Work package transitions are event-audited and idempotent at the API layer.
-- - SLA enforcement records threshold crossings from clocks; never invents ETA.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Bridge: portal service order ↔ work package (tenant-scoped)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portal_order_work_package_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  service_order_id uuid NOT NULL REFERENCES portal_service_orders(id) ON DELETE RESTRICT,
  work_package_id uuid NOT NULL REFERENCES ftth_work_packages(id) ON DELETE RESTRICT,
  link_role text NOT NULL DEFAULT 'primary'
    CHECK (link_role IN ('primary','supporting','rework')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, service_order_id, work_package_id)
);

CREATE INDEX IF NOT EXISTS idx_portal_order_wp_links_order
  ON portal_order_work_package_links (tenant_id, service_order_id);
CREATE INDEX IF NOT EXISTS idx_portal_order_wp_links_wp
  ON portal_order_work_package_links (tenant_id, work_package_id);

ALTER TABLE portal_order_work_package_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_order_work_package_links FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portal_order_wp_links_tenant ON portal_order_work_package_links;
CREATE POLICY portal_order_wp_links_tenant ON portal_order_work_package_links
  FOR ALL
  USING (tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid)
  WITH CHECK (tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid);

DROP POLICY IF EXISTS portal_order_wp_links_app ON portal_order_work_package_links;
CREATE POLICY portal_order_wp_links_app ON portal_order_work_package_links
  FOR ALL TO fiberos_app
  USING (
    tenant_id = NULLIF(current_setting('request.jwt.claim.tenant_id', true), '')::uuid
    OR tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('request.jwt.claim.tenant_id', true), '')::uuid
    OR tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid
  );

GRANT SELECT, INSERT ON portal_order_work_package_links TO fiberos_app;

-- ---------------------------------------------------------------------------
-- 2. Contractor work-package lifecycle events (immutable audit)
-- Maps to ftth_work_packages.status; does not invent parallel status truth.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contractor_work_package_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  work_package_id uuid NOT NULL REFERENCES ftth_work_packages(id) ON DELETE RESTRICT,
  from_status text,
  to_status text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'assigned','accepted','started','evidence_submitted','qc_submitted',
    'rework_requested','measurement_recorded','tech_accepted',
    'commercially_approved','closed','cancelled','blocked'
  )),
  actor_id uuid,
  evidence_refs text[] NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event_idempotency_key text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, event_idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_contractor_wp_events_wp
  ON contractor_work_package_events (tenant_id, work_package_id, occurred_at);

ALTER TABLE contractor_work_package_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE contractor_work_package_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contractor_wp_events_tenant ON contractor_work_package_events;
CREATE POLICY contractor_wp_events_tenant ON contractor_work_package_events
  FOR ALL
  USING (tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid)
  WITH CHECK (tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid);

DROP POLICY IF EXISTS contractor_wp_events_app ON contractor_work_package_events;
CREATE POLICY contractor_wp_events_app ON contractor_work_package_events
  FOR ALL TO fiberos_app
  USING (
    tenant_id = NULLIF(current_setting('request.jwt.claim.tenant_id', true), '')::uuid
    OR tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('request.jwt.claim.tenant_id', true), '')::uuid
    OR tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid
  );

CREATE OR REPLACE FUNCTION public.fiberos_contractor_wp_events_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CONTRACTOR_WP_EVENTS_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS trg_contractor_wp_events_immutable ON contractor_work_package_events;
CREATE TRIGGER trg_contractor_wp_events_immutable
  BEFORE UPDATE OR DELETE ON contractor_work_package_events
  FOR EACH ROW EXECUTE FUNCTION public.fiberos_contractor_wp_events_immutable();

GRANT SELECT, INSERT ON contractor_work_package_events TO fiberos_app;

-- ---------------------------------------------------------------------------
-- 3. Commercial measurement → invoice reconciliation (Maker/Checker)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commercial_measurement_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  measurement_id uuid NOT NULL REFERENCES contractor_work_measurements(id) ON DELETE RESTRICT,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN (
    'open','checker_approved','invoiced','payment_pending',
    'payment_reconciled','disputed','cancelled'
  )),
  maker_id uuid NOT NULL,
  checker_id uuid,
  maker_at timestamptz NOT NULL DEFAULT now(),
  checker_at timestamptz,
  provider_payment_ref text,
  provider_evidence_class text CHECK (
    provider_evidence_class IS NULL OR provider_evidence_class IN (
      'observed','measured','derived','declared','unverified','provider_callback'
    )
  ),
  reconciliation_notes text,
  event_idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event_idempotency_key),
  UNIQUE (tenant_id, measurement_id)
);

CREATE INDEX IF NOT EXISTS idx_commercial_recon_tenant_status
  ON commercial_measurement_reconciliation (tenant_id, status, created_at DESC);

ALTER TABLE commercial_measurement_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_measurement_reconciliation FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commercial_recon_tenant ON commercial_measurement_reconciliation;
CREATE POLICY commercial_recon_tenant ON commercial_measurement_reconciliation
  FOR ALL
  USING (tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid)
  WITH CHECK (tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid);

DROP POLICY IF EXISTS commercial_recon_app ON commercial_measurement_reconciliation;
CREATE POLICY commercial_recon_app ON commercial_measurement_reconciliation
  FOR ALL TO fiberos_app
  USING (
    tenant_id = NULLIF(current_setting('request.jwt.claim.tenant_id', true), '')::uuid
    OR tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('request.jwt.claim.tenant_id', true), '')::uuid
    OR tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid
  );

-- Segregation of duties: maker cannot be checker; payment_reconciled requires provider ref
CREATE OR REPLACE FUNCTION public.fiberos_commercial_recon_sod_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.checker_id IS NOT NULL AND NEW.checker_id = NEW.maker_id THEN
    RAISE EXCEPTION 'COMMERCIAL_RECON_SEPARATION_OF_DUTIES_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IN ('checker_approved', 'invoiced', 'payment_pending', 'payment_reconciled')
     AND NEW.checker_id IS NULL THEN
    RAISE EXCEPTION 'COMMERCIAL_RECON_CHECKER_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'payment_reconciled' AND (
       NEW.provider_payment_ref IS NULL OR length(trim(NEW.provider_payment_ref)) < 4
     ) THEN
    RAISE EXCEPTION 'COMMERCIAL_RECON_PROVIDER_EVIDENCE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'payment_reconciled' AND (
       NEW.provider_evidence_class IS NULL
       OR NEW.provider_evidence_class NOT IN ('provider_callback', 'measured', 'observed')
     ) THEN
    RAISE EXCEPTION 'COMMERCIAL_RECON_PROVIDER_EVIDENCE_CLASS_INVALID' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_commercial_recon_sod ON commercial_measurement_reconciliation;
CREATE TRIGGER trg_commercial_recon_sod
  BEFORE INSERT OR UPDATE ON commercial_measurement_reconciliation
  FOR EACH ROW EXECUTE FUNCTION public.fiberos_commercial_recon_sod_guard();

GRANT SELECT, INSERT, UPDATE ON commercial_measurement_reconciliation TO fiberos_app;

-- ---------------------------------------------------------------------------
-- 4. SLA enforcement events (threshold crossings from clocks — no ETA invention)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portal_sla_enforcement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  contract_id uuid NOT NULL REFERENCES portal_sla_contracts(id) ON DELETE RESTRICT,
  subject_type text NOT NULL CHECK (subject_type IN ('ticket','service_order','incident','service','work_package')),
  subject_id uuid NOT NULL,
  clock_kind text NOT NULL CHECK (clock_kind IN ('response','restore','resolution')),
  threshold_pct numeric(5,2) NOT NULL CHECK (threshold_pct IN (80, 100)),
  elapsed_minutes numeric(12,3) NOT NULL CHECK (elapsed_minutes >= 0),
  limit_minutes integer NOT NULL CHECK (limit_minutes > 0),
  state text NOT NULL CHECK (state IN ('breach_risk','breached')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  source_event_ids uuid[] NOT NULL DEFAULT '{}',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_idempotency_key text NOT NULL,
  UNIQUE (tenant_id, event_idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_sla_enforcement_subject
  ON portal_sla_enforcement_events (tenant_id, subject_type, subject_id, detected_at DESC);

ALTER TABLE portal_sla_enforcement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_sla_enforcement_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portal_sla_enforcement_tenant ON portal_sla_enforcement_events;
CREATE POLICY portal_sla_enforcement_tenant ON portal_sla_enforcement_events
  FOR ALL
  USING (tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid)
  WITH CHECK (tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid);

DROP POLICY IF EXISTS portal_sla_enforcement_app ON portal_sla_enforcement_events;
CREATE POLICY portal_sla_enforcement_app ON portal_sla_enforcement_events
  FOR ALL TO fiberos_app
  USING (
    tenant_id = NULLIF(current_setting('request.jwt.claim.tenant_id', true), '')::uuid
    OR tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('request.jwt.claim.tenant_id', true), '')::uuid
    OR tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid
  );

CREATE OR REPLACE FUNCTION public.fiberos_sla_enforcement_events_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'PORTAL_SLA_ENFORCEMENT_EVENTS_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS trg_sla_enforcement_immutable ON portal_sla_enforcement_events;
CREATE TRIGGER trg_sla_enforcement_immutable
  BEFORE UPDATE OR DELETE ON portal_sla_enforcement_events
  FOR EACH ROW EXECUTE FUNCTION public.fiberos_sla_enforcement_events_immutable();

GRANT SELECT, INSERT ON portal_sla_enforcement_events TO fiberos_app;

COMMIT;
