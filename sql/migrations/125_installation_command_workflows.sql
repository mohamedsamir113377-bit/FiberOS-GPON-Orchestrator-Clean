-- 125_installation_command_workflows.sql
-- Customer intake + New Installation + Migration/Replacement + Router Installation.
-- No synthetic dispatch, WhatsApp delivery, GPS, OCR, or completion is created here.
-- Evidence is persisted only when explicitly submitted by an authenticated actor.
BEGIN;

CREATE TABLE IF NOT EXISTS installation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_code text NOT NULL,
  workflow_type text NOT NULL CHECK (workflow_type IN ('NEW_INSTALLATION','MIGRATION','ROUTER_INSTALLATION')),
  status text NOT NULL DEFAULT 'INTAKE'
    CHECK (status IN ('INTAKE','CALL_CENTER_REVIEW','SCHEDULED','DISPATCHED','TECHNICIAN_ACCEPTED','IN_PROGRESS','AWAITING_CUSTOMER_CONFIRMATION','COMPLETED','REJECTED','CANCELLED','SLA_BREACHED')),
  customer_account_id uuid REFERENCES customer_accounts(id) ON DELETE RESTRICT,
  service_id uuid REFERENCES services(id) ON DELETE SET NULL,
  service_number text NOT NULL,
  landline_number text NOT NULL,
  customer_name text NOT NULL,
  internet_provider_name text,
  company_name text,
  followup_mobile_1 text,
  followup_mobile_2 text,
  identity_type text CHECK (identity_type IN ('NATIONAL_ID','PASSPORT','DRIVING_LICENSE')),
  identity_number_ciphertext text,
  identity_number_last4 text,
  address_region text NOT NULL,
  address_street text NOT NULL,
  address_building_number text NOT NULL,
  address_floor text,
  address_apartment text,
  cabinet_code text,
  box_code text,
  site_location geography(Point,4326) NOT NULL,
  call_center_verified boolean NOT NULL DEFAULT false,
  router_data_verified boolean NOT NULL DEFAULT false,
  work_order_issued_at timestamptz,
  visit_scheduled_at timestamptz,
  technician_id uuid REFERENCES technicians(id) ON DELETE SET NULL,
  customer_tracking_token_hash char(64),
  customer_tracking_token_ciphertext text,
  customer_tracking_expires_at timestamptz,
  customer_tracking_revoked boolean NOT NULL DEFAULT false,
  technician_accepted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  sla_duration_hours numeric(8,2),
  sla_deadline_at timestamptz,
  central_penalty_status text NOT NULL DEFAULT 'NOT_APPLICABLE'
    CHECK (central_penalty_status IN ('NOT_APPLICABLE','ELIGIBLE','RECORDED')),
  migration_work_order_date timestamptz,
  migration_completion_deadline_at timestamptz,
  customer_satisfaction_rating smallint CHECK (customer_satisfaction_rating BETWEEN 1 AND 5),
  customer_feedback text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, job_code)
);

CREATE INDEX IF NOT EXISTS idx_installation_jobs_tenant_status
  ON installation_jobs(tenant_id,status,visit_scheduled_at);
CREATE INDEX IF NOT EXISTS idx_installation_jobs_site
  ON installation_jobs USING gist(site_location);
CREATE INDEX IF NOT EXISTS idx_installation_jobs_tech
  ON installation_jobs(tenant_id,technician_id,status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_installation_jobs_tracking_token
  ON installation_jobs(customer_tracking_token_hash)
  WHERE customer_tracking_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS installation_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL REFERENCES installation_jobs(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('IDENTITY_FRONT','IDENTITY_BACK','ADDRESS_PROOF','OTHER')),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','application/pdf')),
  sha256 char(64) NOT NULL,
  content_ciphertext text,
  ocr_text_ciphertext text,
  captured_at timestamptz NOT NULL,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id,document_type,sha256)
);
CREATE INDEX IF NOT EXISTS idx_installation_documents_job ON installation_documents(tenant_id,job_id,created_at);

CREATE TABLE IF NOT EXISTS installation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL REFERENCES installation_jobs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  gps geography(Point,4326),
  evidence_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_installation_events_job_time
  ON installation_events(tenant_id,job_id,occurred_at);

CREATE TABLE IF NOT EXISTS installation_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL REFERENCES installation_jobs(id) ON DELETE CASCADE,
  evidence_type text NOT NULL CHECK (evidence_type IN (
    'DROP_CABLE_VIDEO','ROUTER_INSTALLATION_VIDEO','ROUTER_LABEL_SCAN',
    'OPTICAL_POWER','SITE_PHOTO','CUSTOMER_ACCEPTANCE'
  )),
  captured_at timestamptz NOT NULL,
  gps geography(Point,4326),
  content_sha256 char(64) NOT NULL,
  storage_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id,evidence_type,content_sha256)
);
CREATE INDEX IF NOT EXISTS idx_installation_evidence_job ON installation_evidence(tenant_id,job_id,created_at);

CREATE TABLE IF NOT EXISTS installation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL REFERENCES installation_jobs(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('WHATSAPP','SMS','IN_APP')),
  recipient text NOT NULL,
  template_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED','SENT_TO_PROVIDER','DELIVERED','FAILED','UNVERIFIED')),
  provider_message_id text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_installation_messages_job ON installation_messages(tenant_id,job_id,queued_at DESC);

CREATE TABLE IF NOT EXISTS router_installation_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL UNIQUE REFERENCES installation_jobs(id) ON DELETE CASCADE,
  router_serial text,
  router_model text,
  router_mac text,
  router_label_scan_sha256 char(64),
  router_label_ocr_ciphertext text,
  installation_video_sha256 char(64),
  installation_video_reference text,
  verified_by_call_center boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'installation_jobs','installation_documents','installation_events',
    'installation_evidence','installation_messages','router_installation_details'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON %I',t,t);
    EXECUTE format(
      'CREATE POLICY %I_tenant ON %I FOR ALL TO authenticated USING (fiberos_enterprise_tenant_ok(tenant_id)) WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id))',
      t,t
    );
  END LOOP;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['installation_documents','installation_events','installation_evidence','installation_messages','router_installation_details'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_job_tenant ON public.%s',t,t);
  END LOOP;
END $$;

DO $$
DECLARE child text;
BEGIN
  FOREACH child IN ARRAY ARRAY['installation_documents','installation_events','installation_evidence','installation_messages','router_installation_details'] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%s_job_tenant BEFORE INSERT OR UPDATE OF job_id, tenant_id ON public.%s FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match(''installation_jobs'', ''id'', ''job_id'')',
      child, child
    );
  END LOOP;
END $$;


-- Public tracking: narrow SELECT via transaction-local token hash GUC only
DROP POLICY IF EXISTS installation_jobs_public_tracking_select ON installation_jobs;
CREATE POLICY installation_jobs_public_tracking_select ON installation_jobs
  FOR SELECT
  USING (
    customer_tracking_token_hash IS NOT NULL
    AND length(nullif(current_setting('fiberos.public_tracking_token_hash', true), '')) = 64
    AND customer_tracking_token_hash = current_setting('fiberos.public_tracking_token_hash', true)
    AND customer_tracking_revoked = false
    AND customer_tracking_expires_at IS NOT NULL
    AND customer_tracking_expires_at > now()
  );

-- Single source of truth: job.router_data_verified must match router details when present
CREATE OR REPLACE FUNCTION fiberos_installation_job_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  detail_verified boolean;
BEGIN
  IF NEW.workflow_type='MIGRATION' AND NEW.migration_work_order_date IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_WORK_ORDER_DATE_REQUIRED' USING ERRCODE='22023';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.workflow_type='ROUTER_INSTALLATION' THEN
    SELECT verified_by_call_center INTO detail_verified
      FROM router_installation_details WHERE job_id = NEW.id LIMIT 1;
    IF detail_verified IS NOT NULL THEN
      NEW.router_data_verified := detail_verified;
    END IF;
  END IF;

  IF NEW.workflow_type='ROUTER_INSTALLATION' AND NEW.router_data_verified = false
     AND NEW.status IN ('DISPATCHED','TECHNICIAN_ACCEPTED','IN_PROGRESS','AWAITING_CUSTOMER_CONFIRMATION','COMPLETED') THEN
    RAISE EXCEPTION 'ROUTER_CALL_CENTER_VERIFICATION_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF NEW.status='COMPLETED' AND NEW.completed_at IS NULL THEN
    RAISE EXCEPTION 'COMPLETION_TIMESTAMP_REQUIRED' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_installation_job_guard ON installation_jobs;
CREATE TRIGGER trg_installation_job_guard
BEFORE INSERT OR UPDATE ON installation_jobs
FOR EACH ROW EXECUTE FUNCTION fiberos_installation_job_guard();

COMMIT;
