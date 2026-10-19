-- 132_fault_workflows.sql
-- FTTH fault intake + call-center verification + appointment + geo dispatch + field resolution.
-- No synthetic fault, GPS, technician position, notification, optical reading or evidence is created.
BEGIN;

CREATE TABLE IF NOT EXISTS fault_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_code text NOT NULL,
  status text NOT NULL DEFAULT 'INTAKE'
    CHECK (status IN ('INTAKE','CALL_CENTER_REVIEW','SCHEDULED','DISPATCHED','TECHNICIAN_ACCEPTED','IN_PROGRESS','AWAITING_CUSTOMER_CONFIRMATION','RESOLVED','REJECTED','CANCELLED','SLA_BREACHED')),
  service_number text NOT NULL,
  landline_number text,
  customer_name text NOT NULL,
  landline_company_name text,
  internet_provider_name text,
  followup_mobile_1 text,
  followup_mobile_2 text,
  address_region text NOT NULL,
  address_street text NOT NULL,
  address_building_number text NOT NULL,
  address_floor text,
  address_apartment text,
  cabinet_code text,
  box_code text,
  site_location geography(Point,4326) NOT NULL,
  fault_type text NOT NULL CHECK (fault_type IN ('OPTICAL_LOSS','NO_SYNC','DROP_DAMAGE','CPE','POWER','INTERMITTENT','UNKNOWN')),
  fault_description text NOT NULL,
  severity text NOT NULL DEFAULT 'P2' CHECK (severity IN ('P1','P2','P3','P4')),
  outage_started_at timestamptz,
  call_center_verified boolean NOT NULL DEFAULT false,
  visit_scheduled_at timestamptz,
  technician_id uuid REFERENCES technicians(id) ON DELETE SET NULL,
  customer_tracking_token_hash char(64),
  customer_tracking_token_ciphertext text,
  customer_tracking_expires_at timestamptz,
  customer_tracking_revoked boolean NOT NULL DEFAULT false,
  technician_accepted_at timestamptz,
  started_at timestamptz,
  resolved_at timestamptz,
  sla_duration_hours numeric(8,2),
  sla_deadline_at timestamptz,
  customer_acceptance boolean NOT NULL DEFAULT false,
  customer_satisfaction_rating smallint CHECK (customer_satisfaction_rating BETWEEN 1 AND 5),
  customer_feedback text,
  resolution_code text,
  resolution_notes text,
  central_penalty_status text NOT NULL DEFAULT 'NOT_APPLICABLE'
    CHECK (central_penalty_status IN ('NOT_APPLICABLE','ELIGIBLE','RECORDED')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,job_code)
);

CREATE INDEX IF NOT EXISTS idx_fault_jobs_tenant_status ON fault_jobs(tenant_id,status,visit_scheduled_at);
CREATE INDEX IF NOT EXISTS idx_fault_jobs_site ON fault_jobs USING gist(site_location);
CREATE INDEX IF NOT EXISTS idx_fault_jobs_tech ON fault_jobs(tenant_id,technician_id,status);
CREATE INDEX IF NOT EXISTS idx_fault_jobs_severity ON fault_jobs(tenant_id,severity,status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fault_jobs_tracking_token ON fault_jobs(customer_tracking_token_hash) WHERE customer_tracking_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS fault_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  fault_job_id uuid NOT NULL REFERENCES fault_jobs(id) ON DELETE CASCADE,
  evidence_type text NOT NULL CHECK (evidence_type IN ('FAULT_PHOTO','FAULT_VIDEO','OPTICAL_POWER','SITE_PHOTO')),
  captured_at timestamptz NOT NULL DEFAULT now(),
  gps geography(Point,4326),
  content_sha256 char(64) NOT NULL,
  storage_reference text,
  storage_status text NOT NULL DEFAULT 'CLIENT_HASH_ONLY'
    CHECK (storage_status IN ('CLIENT_HASH_ONLY','STORAGE_UNVERIFIED','STORAGE_VERIFIED','HASH_MISMATCH','STORAGE_MISSING')),
  provider_verified_sha256 char(64),
  provider_verified_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(fault_job_id,evidence_type,content_sha256)
);
CREATE INDEX IF NOT EXISTS idx_fault_evidence_job ON fault_evidence(tenant_id,fault_job_id,created_at);

CREATE TABLE IF NOT EXISTS fault_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  fault_job_id uuid NOT NULL REFERENCES fault_jobs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  gps geography(Point,4326),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_fault_events_job_time ON fault_events(tenant_id,fault_job_id,occurred_at);

CREATE TABLE IF NOT EXISTS fault_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  fault_job_id uuid NOT NULL REFERENCES fault_jobs(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('WHATSAPP','SMS','IN_APP')),
  recipient text NOT NULL,
  template_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'UNVERIFIED' CHECK (status IN ('QUEUED','SENT_TO_PROVIDER','DELIVERED','FAILED','UNVERIFIED')),
  provider_message_id text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_fault_messages_job ON fault_messages(tenant_id,fault_job_id,queued_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fault_jobs','fault_evidence','fault_events','fault_messages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON %I',t,t);
    EXECUTE format('CREATE POLICY %I_tenant ON %I FOR ALL TO authenticated USING (fiberos_enterprise_tenant_ok(tenant_id)) WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id))',t,t);
  END LOOP;
END $$;

DO $$
DECLARE child text;
BEGIN
  FOREACH child IN ARRAY ARRAY['fault_evidence','fault_events','fault_messages'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_job_tenant ON public.%s',child,child);
    EXECUTE format('CREATE TRIGGER trg_%s_job_tenant BEFORE INSERT OR UPDATE OF fault_job_id,tenant_id ON public.%s FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match(''fault_jobs'', ''id'', ''fault_job_id'')',child,child);
  END LOOP;
END $$;

DROP POLICY IF EXISTS fault_jobs_public_tracking_select ON fault_jobs;
CREATE POLICY fault_jobs_public_tracking_select ON fault_jobs
  FOR SELECT
  USING (
    customer_tracking_token_hash IS NOT NULL
    AND length(nullif(current_setting('fiberos.public_tracking_token_hash', true), '')) = 64
    AND customer_tracking_token_hash = current_setting('fiberos.public_tracking_token_hash', true)
    AND customer_tracking_revoked = false
    AND customer_tracking_expires_at IS NOT NULL
    AND customer_tracking_expires_at > now()
  );

CREATE OR REPLACE FUNCTION fiberos_fault_lifecycle_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, auth AS $$
BEGIN
  IF TG_OP <> 'UPDATE' OR NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF OLD.status='INTAKE' AND NEW.status IN ('CALL_CENTER_REVIEW','REJECTED','CANCELLED','SLA_BREACHED') THEN RETURN NEW;
  ELSIF OLD.status='CALL_CENTER_REVIEW' AND NEW.status IN ('SCHEDULED','REJECTED','CANCELLED','SLA_BREACHED') THEN RETURN NEW;
  ELSIF OLD.status='SCHEDULED' AND NEW.status IN ('DISPATCHED','REJECTED','CANCELLED','SLA_BREACHED') THEN RETURN NEW;
  ELSIF OLD.status='DISPATCHED' AND NEW.status IN ('TECHNICIAN_ACCEPTED','REJECTED','CANCELLED','SLA_BREACHED') THEN RETURN NEW;
  ELSIF OLD.status='TECHNICIAN_ACCEPTED' AND NEW.status IN ('IN_PROGRESS','REJECTED','CANCELLED','SLA_BREACHED') THEN RETURN NEW;
  ELSIF OLD.status='IN_PROGRESS' AND NEW.status IN ('AWAITING_CUSTOMER_CONFIRMATION','REJECTED','CANCELLED','SLA_BREACHED') THEN RETURN NEW;
  ELSIF OLD.status='AWAITING_CUSTOMER_CONFIRMATION' AND NEW.status IN ('RESOLVED','REJECTED','CANCELLED','SLA_BREACHED') THEN RETURN NEW;
  ELSIF OLD.status='SLA_BREACHED' AND NEW.status IN ('REJECTED','CANCELLED') THEN RETURN NEW;
  END IF;
  RAISE EXCEPTION 'FAULT_INVALID_STATE_TRANSITION: % -> %', OLD.status, NEW.status USING ERRCODE='22023';
END; $$;
REVOKE ALL ON FUNCTION public.fiberos_fault_lifecycle_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_fault_lifecycle_guard ON fault_jobs;
CREATE TRIGGER trg_fault_lifecycle_guard BEFORE UPDATE OF status ON fault_jobs FOR EACH ROW EXECUTE FUNCTION public.fiberos_fault_lifecycle_guard();

COMMIT;
