-- R14.1 contractor execution, acceptance and commercial measurement controls.
BEGIN;
CREATE TABLE IF NOT EXISTS contractor_qualifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  contractor_id uuid NOT NULL REFERENCES contractor_entities(id) ON DELETE CASCADE, qualification_type text NOT NULL, status text NOT NULL
    CHECK(status IN ('pending','valid','expired','revoked')), valid_from timestamptz, valid_to timestamptz, evidence_reference text,
  approved_by uuid, approved_at timestamptz, UNIQUE(tenant_id,contractor_id,qualification_type)
);

CREATE TABLE IF NOT EXISTS contractor_work_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  contractor_id uuid NOT NULL REFERENCES contractor_entities(id) ON DELETE RESTRICT, work_package_id uuid NOT NULL REFERENCES ftth_work_packages(id) ON DELETE RESTRICT,
  quantity numeric(18,4) NOT NULL CHECK(quantity>0), unit text NOT NULL, rate_minor bigint NOT NULL CHECK(rate_minor>=0), currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','verified','rejected','approved','invoiced','paid')),
  measured_by uuid NOT NULL, verified_by uuid, evidence_reference text, measured_at timestamptz NOT NULL, verified_at timestamptz,
  UNIQUE(tenant_id,contractor_id,work_package_id,unit)
);

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['contractor_qualifications','contractor_work_measurements'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON %I',t,t);
  EXECUTE format('CREATE POLICY %I_tenant ON %I FOR ALL TO authenticated USING (fiberos_enterprise_tenant_ok(tenant_id)) WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id))',t,t);
END LOOP; END $$;

CREATE OR REPLACE FUNCTION fiberos_measurement_approval_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER set search_path=pg_catalog,public,auth AS $$
BEGIN
  IF NEW.status IN ('verified','approved') AND NEW.verified_by IS NULL THEN
    RAISE EXCEPTION 'CONTRACTOR_MEASUREMENT_REQUIRES_INDEPENDENT_VERIFICATION' USING ERRCODE='42501';
  END IF;
  IF NEW.status='approved' AND NEW.verified_by=NEW.measured_by THEN
    RAISE EXCEPTION 'CONTRACTOR_MEASUREMENT_SEPARATION_OF_DUTIES_REQUIRED' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_contractor_measurement_guard ON contractor_work_measurements;
CREATE TRIGGER trg_contractor_measurement_guard BEFORE INSERT OR UPDATE ON contractor_work_measurements FOR EACH ROW EXECUTE FUNCTION fiberos_measurement_approval_guard();

ALTER TABLE contractor_qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE contractor_work_measurements ENABLE ROW LEVEL SECURITY;
COMMIT;
