-- R14.1 Enterprise FTTH Operating Model foundation.
-- Additive only. No synthetic operational data. Server/database remain authoritative.
BEGIN;

CREATE TABLE IF NOT EXISTS enterprise_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  department_type text NOT NULL CHECK (department_type IN ('corporate','sector','regional','central','team','network','field','warehouse','data_noc','planning','engineering','quality','hse','procurement','finance','hr','customer','security','other')),
  parent_id uuid REFERENCES enterprise_departments(id) ON DELETE RESTRICT,
  head_user_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_enterprise_departments_parent ON enterprise_departments(tenant_id,parent_id);

CREATE TABLE IF NOT EXISTS enterprise_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  department_id uuid NOT NULL REFERENCES enterprise_departments(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  title text NOT NULL,
  authority_level integer NOT NULL CHECK (authority_level >= 0 AND authority_level <= 100),
  manager_position_id uuid REFERENCES enterprise_positions(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  UNIQUE (tenant_id,user_id,department_id)
);
CREATE INDEX IF NOT EXISTS idx_enterprise_positions_manager ON enterprise_positions(tenant_id,manager_position_id);
CREATE INDEX IF NOT EXISTS idx_enterprise_positions_department ON enterprise_positions(tenant_id,department_id);

CREATE TABLE IF NOT EXISTS enterprise_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  policy_key text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  rule jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','approved','retired')),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,policy_key,version)
);

CREATE TABLE IF NOT EXISTS enterprise_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  decision_key text NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  decided_by uuid,
  decision text NOT NULL CHECK (decision IN ('pending','approved','rejected','cancelled')),
  reason text,
  policy_version integer,
  evidence_reference text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_enterprise_decisions_subject ON enterprise_decisions(tenant_id,subject_type,subject_id);
CREATE INDEX IF NOT EXISTS idx_enterprise_decisions_pending ON enterprise_decisions(tenant_id,decision) WHERE decision='pending';

CREATE OR REPLACE FUNCTION fiberos_enterprise_tenant_ok(p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER set search_path = pg_catalog, public, auth AS $$
  SELECT p_tenant_id IS NOT DISTINCT FROM fiberos_session_tenant_id();
$$;
REVOKE ALL ON FUNCTION fiberos_enterprise_tenant_ok(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fiberos_enterprise_tenant_ok(uuid) TO authenticated;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['enterprise_departments','enterprise_positions','enterprise_policies','enterprise_decisions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS enterprise_departments_tenant ON enterprise_departments;
CREATE POLICY enterprise_departments_tenant ON enterprise_departments FOR ALL TO authenticated
USING (fiberos_enterprise_tenant_ok(tenant_id)) WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id));
DROP POLICY IF EXISTS enterprise_positions_tenant ON enterprise_positions;
CREATE POLICY enterprise_positions_tenant ON enterprise_positions FOR ALL TO authenticated
USING (fiberos_enterprise_tenant_ok(tenant_id)) WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id));
DROP POLICY IF EXISTS enterprise_policies_tenant ON enterprise_policies;
CREATE POLICY enterprise_policies_tenant ON enterprise_policies FOR ALL TO authenticated
USING (fiberos_enterprise_tenant_ok(tenant_id)) WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id));
DROP POLICY IF EXISTS enterprise_decisions_tenant ON enterprise_decisions;
CREATE POLICY enterprise_decisions_tenant ON enterprise_decisions FOR ALL TO authenticated
USING (fiberos_enterprise_tenant_ok(tenant_id)) WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id));

CREATE OR REPLACE FUNCTION fiberos_enterprise_position_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER set search_path = pg_catalog, public, auth AS $$
DECLARE mgr_level integer;
BEGIN
  IF NEW.manager_position_id IS NULL THEN
    IF NEW.authority_level < 90 THEN
      RAISE EXCEPTION 'ENTERPRISE_NON_ROOT_POSITION_REQUIRES_MANAGER' USING ERRCODE='22023';
    END IF;
  ELSE
    SELECT authority_level INTO mgr_level FROM enterprise_positions WHERE id=NEW.manager_position_id AND tenant_id=NEW.tenant_id;
    IF mgr_level IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_MANAGER_NOT_FOUND' USING ERRCODE='23503'; END IF;
    IF mgr_level <= NEW.authority_level THEN RAISE EXCEPTION 'ENTERPRISE_MANAGER_MUST_BE_MORE_SENIOR' USING ERRCODE='42501'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_enterprise_position_guard ON enterprise_positions;
CREATE TRIGGER trg_enterprise_position_guard BEFORE INSERT OR UPDATE ON enterprise_positions FOR EACH ROW EXECUTE FUNCTION fiberos_enterprise_position_guard();


-- Static-audit-visible RLS declarations.
ALTER TABLE enterprise_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_decisions ENABLE ROW LEVEL SECURITY;

COMMIT;
