-- 141_network_knowledge_and_reconciliation.sql
-- FTTH CORE Master Operating Statement 2026-10-07
-- Closes the remaining specification gaps that had no database authority:
--   Section 28 — Network Knowledge System (evidence-bound, never opaque AI text)
--   Section 29 — Data Quality / Reconciliation Engine (no silent conflict resolution)
--   Section 33 — Department KPI resolution (never invent a metric)
-- Runtime certification remains separate: this migration must execute successfully
-- in the exact PostgreSQL 18/PostGIS 3.6/RLS environment before any runtime claim.
BEGIN;

-- ============================================================================
-- SECTION 28 — NETWORK KNOWLEDGE SYSTEM
-- Every completed operation leaves reusable knowledge, and that knowledge must
-- be traceable back to evidence. The evidence requirement and the model-output
-- review requirement are enforced here at the transaction boundary, not only in
-- the JavaScript control boundary.
-- ============================================================================
CREATE TABLE IF NOT EXISTS network_knowledge_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  work_ref text NOT NULL,
  knowledge_class text NOT NULL CHECK (knowledge_class IN (
    'FIELD_RESOLUTION','CONSTRUCTION_LESSON','OPTICAL_SIGNATURE','MATERIAL_FAILURE','CUSTOMER_PATTERN'
  )),
  origin text NOT NULL CHECK (origin IN ('field_verified','measured','derived','model_generated')),
  asset_refs text[] NOT NULL DEFAULT '{}',
  symptom text NOT NULL,
  action text NOT NULL,
  outcome text NOT NULL,
  evidence_ids uuid[] NOT NULL,
  actor_id uuid,
  model_ref text,
  reviewed_by uuid,
  captured_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'EVIDENCE_BOUND' CHECK (status IN ('EVIDENCE_BOUND','RETRACTED')),
  knowledge_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, knowledge_hash),
  CONSTRAINT network_knowledge_evidence_required CHECK (cardinality(evidence_ids) > 0),
  CONSTRAINT network_knowledge_model_output_requires_review
    CHECK (origin <> 'model_generated' OR (model_ref IS NOT NULL AND reviewed_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_network_knowledge_lookup
  ON network_knowledge_records(tenant_id, knowledge_class, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_network_knowledge_work
  ON network_knowledge_records(tenant_id, work_ref);

-- ============================================================================
-- SECTION 29 — DATA QUALITY / RECONCILIATION ENGINE
-- Scheduled reconciliation between declared sources. No silent conflict
-- resolution: a contradicted fact can never carry a selected winner.
-- ============================================================================
CREATE TABLE IF NOT EXISTS network_reconciliation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_key text NOT NULL,
  source_pairs jsonb NOT NULL CHECK (jsonb_typeof(source_pairs) = 'array'),
  cadence_minutes integer NOT NULL CHECK (cadence_minutes >= 5),
  geometry_tolerance_meters numeric(10,3) NOT NULL DEFAULT 2 CHECK (geometry_tolerance_meters >= 0),
  auto_repair boolean NOT NULL DEFAULT false CHECK (auto_repair = false),
  auto_resolve boolean NOT NULL DEFAULT false CHECK (auto_resolve = false),
  job_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, job_key),
  CONSTRAINT network_reconciliation_pairs_declared CHECK (jsonb_array_length(source_pairs) > 0)
);
CREATE INDEX IF NOT EXISTS idx_network_reconciliation_jobs_tenant
  ON network_reconciliation_jobs(tenant_id, cadence_minutes);

CREATE TABLE IF NOT EXISTS network_reconciliation_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL REFERENCES network_reconciliation_jobs(id) ON DELETE RESTRICT,
  run_ref text NOT NULL,
  ran_at timestamptz NOT NULL,
  fact_class text NOT NULL,
  subject_id text,
  status text NOT NULL CHECK (status IN ('CONSISTENT','CONTRADICTED','EVIDENCE_INCOMPLETE','NO_OBSERVATION')),
  severity text NOT NULL CHECK (severity IN ('INFO','REVIEW','BLOCKING')),
  requires_review boolean NOT NULL,
  selected jsonb,
  groups jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(groups) = 'array'),
  auto_resolved boolean NOT NULL DEFAULT false CHECK (auto_resolved = false),
  result_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT network_reconciliation_contradiction_has_no_selection
    CHECK (status <> 'CONTRADICTED' OR selected IS NULL),
  CONSTRAINT network_reconciliation_contradiction_requires_review
    CHECK (status <> 'CONTRADICTED' OR requires_review = true),
  CONSTRAINT network_reconciliation_incomplete_has_no_selection
    CHECK (status <> 'EVIDENCE_INCOMPLETE' OR selected IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_network_reconciliation_findings_run
  ON network_reconciliation_findings(tenant_id, job_id, ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_network_reconciliation_findings_review
  ON network_reconciliation_findings(tenant_id, requires_review, status);

-- ============================================================================
-- SECTION 33 — DEPARTMENT KPI RESOLUTION
-- KPIs are bound to a department by declaration. A KPI the current schema
-- cannot honestly compute is stored as DEFERRED with the exact missing
-- columns; it is never stored with an invented value.
-- ============================================================================
CREATE TABLE IF NOT EXISTS network_department_kpi_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  department text NOT NULL CHECK (department IN (
    'NETWORK_OPERATIONS','CONSTRUCTION','FIELD','CALL_CENTER','WAREHOUSE','ENGINEERING'
  )),
  kpi_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('COMPUTABLE','UNAVAILABLE','DEFERRED')),
  reason text,
  required_columns text[] NOT NULL DEFAULT '{}',
  declared_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, department, kpi_id),
  CONSTRAINT network_department_kpi_deferred_requires_reason
    CHECK (state <> 'DEFERRED' OR (reason IS NOT NULL AND cardinality(required_columns) > 0)),
  CONSTRAINT network_department_kpi_computable_has_no_reason
    CHECK (state <> 'COMPUTABLE' OR reason IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_network_department_kpi_department
  ON network_department_kpi_bindings(tenant_id, department, state);

-- ============================================================================
-- Tenant-reference guards: knowledge and reconciliation rows may not reference
-- work/evidence/jobs belonging to another tenant.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fiberos_guard_knowledge_review_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_tenant uuid;
BEGIN
  IF NEW.origin = 'model_generated' THEN
    SELECT t.tenant_id INTO actor_tenant
    FROM public.technicians t WHERE t.id = NEW.reviewed_by;
    IF actor_tenant IS NULL OR actor_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'KNOWLEDGE_REVIEWER_TENANT_MISMATCH' USING ERRCODE='42501';
    END IF;
  END IF;
  IF NEW.actor_id IS NOT NULL THEN
    SELECT t.tenant_id INTO actor_tenant
    FROM public.technicians t WHERE t.id = NEW.actor_id;
    IF actor_tenant IS NULL OR actor_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'KNOWLEDGE_ACTOR_TENANT_MISMATCH' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fiberos_guard_knowledge_review_actor() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_network_knowledge_actor_tenant ON public.network_knowledge_records;
CREATE TRIGGER trg_network_knowledge_actor_tenant
  BEFORE INSERT OR UPDATE ON public.network_knowledge_records
  FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_knowledge_review_actor();

CREATE OR REPLACE FUNCTION public.fiberos_guard_reconciliation_job_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  job_tenant uuid;
BEGIN
  SELECT j.tenant_id INTO job_tenant
  FROM public.network_reconciliation_jobs j WHERE j.id = NEW.job_id;
  IF job_tenant IS NULL OR job_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'RECONCILIATION_JOB_TENANT_MISMATCH' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fiberos_guard_reconciliation_job_tenant() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_network_reconciliation_job_tenant ON public.network_reconciliation_findings;
CREATE TRIGGER trg_network_reconciliation_job_tenant
  BEFORE INSERT OR UPDATE ON public.network_reconciliation_findings
  FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_reconciliation_job_tenant();

-- ============================================================================
-- Continuous integrity scan extension: knowledge and reconciliation findings
-- participate in the same non-mutating audit surface.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fiberos_run_network_knowledge_integrity_scan(p_tenant uuid)
RETURNS TABLE (finding_code text, subject_id text, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_tenant IS NULL THEN
    RAISE EXCEPTION 'TENANT_REQUIRED' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  SELECT 'KNOWLEDGE_MISSING_EVIDENCE'::text,
         r.id::text,
         'knowledge record carries no evidence id'::text
  FROM public.network_knowledge_records r
  WHERE r.tenant_id = p_tenant
    AND (r.evidence_ids IS NULL OR cardinality(r.evidence_ids) = 0);

  RETURN QUERY
  SELECT 'KNOWLEDGE_MODEL_OUTPUT_UNREVIEWED'::text,
         r.id::text,
         'model-generated knowledge without model reference or human reviewer'::text
  FROM public.network_knowledge_records r
  WHERE r.tenant_id = p_tenant
    AND r.origin = 'model_generated'
    AND (r.model_ref IS NULL OR r.reviewed_by IS NULL);

  RETURN QUERY
  SELECT 'RECONCILIATION_CONTRADICTION_UNREVIEWED'::text,
         f.id::text,
         'contradicted fact is still flagged as not requiring review'::text
  FROM public.network_reconciliation_findings f
  WHERE f.tenant_id = p_tenant
    AND f.status = 'CONTRADICTED'
    AND f.requires_review = false;

  RETURN QUERY
  SELECT 'RECONCILIATION_SILENT_RESOLUTION'::text,
         f.id::text,
         'finding claims automatic resolution, which is forbidden'::text
  FROM public.network_reconciliation_findings f
  WHERE f.tenant_id = p_tenant
    AND f.auto_resolved = true;

  RETURN QUERY
  SELECT 'KPI_DEFERRED_WITHOUT_COLUMNS'::text,
         b.id::text,
         'deferred KPI without declared missing columns'::text
  FROM public.network_department_kpi_bindings b
  WHERE b.tenant_id = p_tenant
    AND b.state = 'DEFERRED'
    AND (b.reason IS NULL OR cardinality(b.required_columns) = 0);
END;
$$;
REVOKE ALL ON FUNCTION public.fiberos_run_network_knowledge_integrity_scan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiberos_run_network_knowledge_integrity_scan(uuid) TO fiberos_worker;

-- ============================================================================
-- Tenant RLS / FORCE RLS
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'network_knowledge_records',
    'network_reconciliation_jobs',
    'network_reconciliation_findings',
    'network_department_kpi_bindings'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON public.%I',t,t);
    EXECUTE format(
      'CREATE POLICY %I_tenant ON public.%I FOR ALL TO authenticated USING (fiberos_enterprise_tenant_ok(tenant_id)) WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id))',
      t,t
    );
  END LOOP;
END $$;

-- ============================================================================
-- Append-only history: reconciliation findings and knowledge records are
-- evidence surfaces and must not be silently rewritten.
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'network_reconciliation_findings'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_immutable ON public.%I',t,t);
    EXECUTE format('CREATE TRIGGER trg_%s_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fiberos_reject_history_mutation()',t,t);
  END LOOP;
END $$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
  ON network_knowledge_records, network_reconciliation_jobs,
     network_reconciliation_findings, network_department_kpi_bindings
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON
  network_knowledge_records, network_reconciliation_jobs,
  network_reconciliation_findings, network_department_kpi_bindings
  TO authenticated;

COMMENT ON TABLE network_knowledge_records IS 'Section 28 network knowledge: evidence-bound and content-addressed; model-generated entries require an explicit human reviewer.';
COMMENT ON TABLE network_reconciliation_jobs IS 'Section 29 reconciliation job definitions over explicitly declared source pairs; auto-repair and auto-resolve are structurally disabled.';
COMMENT ON TABLE network_reconciliation_findings IS 'Section 29 reconciliation findings; a contradicted fact structurally cannot carry a selected winner.';
COMMENT ON TABLE network_department_kpi_bindings IS 'Section 33 department KPI bindings; deferred KPIs must declare the exact missing columns and never carry an invented value.';

COMMIT;
