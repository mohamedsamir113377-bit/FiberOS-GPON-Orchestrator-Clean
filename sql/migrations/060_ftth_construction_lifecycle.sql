-- R14.1 FTTH construction lifecycle. Every state transition is evidence-bearing.
BEGIN;
CREATE TABLE IF NOT EXISTS ftth_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code text NOT NULL, name text NOT NULL, status text NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','approved','executing','accepted','closed','cancelled')),
  geometry geometry(MultiPolygon,4326), owner_department_id uuid REFERENCES enterprise_departments(id), created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,code)
);
CREATE TABLE IF NOT EXISTS ftth_work_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  program_id uuid REFERENCES ftth_programs(id) ON DELETE RESTRICT, code text NOT NULL, work_type text NOT NULL CHECK (work_type IN ('survey','design','permit','civil','duct','cable','splicing','testing','qc','acceptance','drop','activation','maintenance','other')),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','ready','assigned','in_progress','blocked','submitted','qc_pending','rework','accepted','rejected','closed','cancelled')),
  priority integer NOT NULL DEFAULT 50 CHECK(priority BETWEEN 0 AND 100), planned_start timestamptz, planned_end timestamptz, actual_start timestamptz, actual_end timestamptz,
  assigned_department_id uuid REFERENCES enterprise_departments(id), assigned_to uuid, contractor_id uuid, location geometry(Geometry,4326), created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,code)
);
CREATE INDEX IF NOT EXISTS idx_ftth_work_packages_status ON ftth_work_packages(tenant_id,status,priority DESC);
CREATE INDEX IF NOT EXISTS idx_ftth_work_packages_location ON ftth_work_packages USING gist(location);
CREATE TABLE IF NOT EXISTS ftth_work_package_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  work_package_id uuid NOT NULL REFERENCES ftth_work_packages(id) ON DELETE CASCADE, sequence_no integer NOT NULL CHECK(sequence_no>0), task_type text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','in_progress','blocked','submitted','accepted','rejected','skipped')),
  mandatory boolean NOT NULL DEFAULT true, requirements jsonb NOT NULL DEFAULT '{}'::jsonb, completed_by uuid, completed_at timestamptz,
  UNIQUE(work_package_id,sequence_no), UNIQUE(work_package_id,task_type)
);
CREATE TABLE IF NOT EXISTS ftth_work_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  work_package_id uuid NOT NULL REFERENCES ftth_work_packages(id) ON DELETE RESTRICT, from_state text, to_state text NOT NULL,
  actor_id uuid NOT NULL, occurred_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), device_id text, gps geometry(Point,4326), evidence_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, previous_event_hash text, event_hash text NOT NULL,
  UNIQUE(work_package_id,event_hash)
);
CREATE INDEX IF NOT EXISTS idx_ftth_work_events_pkg_time ON ftth_work_events(tenant_id,work_package_id,occurred_at);
CREATE TABLE IF NOT EXISTS ftth_quality_gates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  work_package_id uuid NOT NULL REFERENCES ftth_work_packages(id) ON DELETE CASCADE, gate_type text NOT NULL CHECK(gate_type IN ('design','civil','material','cable','splicing','optical','safety','qc','acceptance','activation')),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','passed','failed','waived')),
  mandatory boolean NOT NULL DEFAULT true, rule_version text NOT NULL, checked_by uuid, checked_at timestamptz, evidence_reference text, findings jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(work_package_id,gate_type)
);
CREATE INDEX IF NOT EXISTS idx_ftth_quality_gates_pending ON ftth_quality_gates(tenant_id,status) WHERE status IN ('pending','failed');
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['ftth_programs','ftth_work_packages','ftth_work_package_tasks','ftth_work_events','ftth_quality_gates'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t); END LOOP; END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['ftth_programs','ftth_work_packages','ftth_work_package_tasks','ftth_work_events','ftth_quality_gates'] LOOP EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON %I',t,t); EXECUTE format('CREATE POLICY %I_tenant ON %I FOR ALL TO authenticated USING (fiberos_enterprise_tenant_ok(tenant_id)) WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id))',t,t); END LOOP; END $$;
CREATE OR REPLACE FUNCTION fiberos_ftth_state_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER set search_path=pg_catalog,public,auth AS $$
BEGIN
  IF NEW.status='accepted' AND EXISTS (SELECT 1 FROM ftth_quality_gates g WHERE g.work_package_id=NEW.id AND g.mandatory AND g.status <> 'passed') THEN
    RAISE EXCEPTION 'FTTH_ACCEPTANCE_BLOCKED_BY_QUALITY_GATE' USING ERRCODE='42501';
  END IF;
  IF TG_OP='UPDATE' AND NEW.status='closed' AND OLD.status NOT IN ('accepted','closed') THEN
    RAISE EXCEPTION 'FTTH_CLOSE_REQUIRES_ACCEPTED_STATE' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ftth_state_guard ON ftth_work_packages;
CREATE TRIGGER trg_ftth_state_guard BEFORE INSERT OR UPDATE ON ftth_work_packages FOR EACH ROW EXECUTE FUNCTION fiberos_ftth_state_guard();

ALTER TABLE ftth_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ftth_work_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ftth_work_package_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ftth_work_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ftth_quality_gates ENABLE ROW LEVEL SECURITY;
COMMIT;
