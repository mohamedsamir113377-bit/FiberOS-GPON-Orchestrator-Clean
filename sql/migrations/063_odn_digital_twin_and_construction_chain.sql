-- R14.1 Enterprise FTTH: physical ODN digital twin + construction chain of custody.
BEGIN;

CREATE TABLE IF NOT EXISTS ftth_duct_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code text NOT NULL, geometry geometry(LineString,4326) NOT NULL, status text NOT NULL DEFAULT 'planned'
    CHECK(status IN ('planned','approved','installed','tested','accepted','retired')),
  diameter_mm numeric(8,2), installed_at timestamptz, accepted_at timestamptz, work_package_id uuid REFERENCES ftth_work_packages(id) ON DELETE SET NULL,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,code)
);
CREATE INDEX IF NOT EXISTS idx_ftth_duct_geom ON ftth_duct_segments USING gist(geometry);

CREATE TABLE IF NOT EXISTS ftth_cable_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code text NOT NULL, cable_type text NOT NULL, fiber_count integer NOT NULL CHECK(fiber_count > 0), geometry geometry(LineString,4326) NOT NULL,
  status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','approved','installed','spliced','tested','accepted','live','retired')),
  material_item_id uuid REFERENCES inventory_items(id) ON DELETE RESTRICT, work_package_id uuid REFERENCES ftth_work_packages(id) ON DELETE SET NULL,
  start_asset_id uuid REFERENCES network_assets(id) ON DELETE RESTRICT, end_asset_id uuid REFERENCES network_assets(id) ON DELETE RESTRICT,
  installed_at timestamptz, accepted_at timestamptz, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,code)
);
CREATE INDEX IF NOT EXISTS idx_ftth_cable_geom ON ftth_cable_segments USING gist(geometry);
CREATE INDEX IF NOT EXISTS idx_ftth_cable_endpoints ON ftth_cable_segments(tenant_id,start_asset_id,end_asset_id);

CREATE TABLE IF NOT EXISTS ftth_splices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  closure_asset_id uuid REFERENCES network_assets(id) ON DELETE RESTRICT, cable_a_id uuid NOT NULL REFERENCES ftth_cable_segments(id) ON DELETE RESTRICT,
  core_a integer NOT NULL CHECK(core_a>0), cable_b_id uuid NOT NULL REFERENCES ftth_cable_segments(id) ON DELETE RESTRICT, core_b integer NOT NULL CHECK(core_b>0),
  loss_db numeric(8,4), method text NOT NULL, technician_id uuid NOT NULL, evidence_reference text, occurred_at timestamptz NOT NULL,
  UNIQUE(tenant_id,cable_a_id,core_a,cable_b_id,core_b)
);

CREATE TABLE IF NOT EXISTS ftth_odn_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  from_asset_id uuid REFERENCES network_assets(id) ON DELETE RESTRICT, from_port_id uuid REFERENCES network_ports(id) ON DELETE RESTRICT,
  to_asset_id uuid REFERENCES network_assets(id) ON DELETE RESTRICT, to_port_id uuid REFERENCES network_ports(id) ON DELETE RESTRICT,
  connection_type text NOT NULL CHECK(connection_type IN ('patch','fiber','splitter','logical','drop','service')),
  fiber_core_id uuid, status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','installed','tested','accepted','live','retired')),
  valid_from timestamptz, valid_to timestamptz, work_package_id uuid REFERENCES ftth_work_packages(id) ON DELETE SET NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ftth_odn_conn_from ON ftth_odn_connections(tenant_id,from_asset_id,from_port_id);
CREATE INDEX IF NOT EXISTS idx_ftth_odn_conn_to ON ftth_odn_connections(tenant_id,to_asset_id,to_port_id);

CREATE TABLE IF NOT EXISTS ftth_construction_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  work_package_id uuid NOT NULL REFERENCES ftth_work_packages(id) ON DELETE CASCADE, evidence_type text NOT NULL,
  captured_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), actor_id uuid NOT NULL, device_id text,
  gps geometry(Point,4326), accuracy_m numeric(10,3), file_reference text, content_sha256 text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(tenant_id,content_sha256) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX IF NOT EXISTS idx_ftth_construction_evidence_work_time ON ftth_construction_evidence(tenant_id,work_package_id,captured_at);
CREATE INDEX IF NOT EXISTS idx_ftth_construction_evidence_gps ON ftth_construction_evidence USING gist(gps);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['ftth_duct_segments','ftth_cable_segments','ftth_splices','ftth_odn_connections','ftth_construction_evidence'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON %I',t,t);
    EXECUTE format('CREATE POLICY %I_tenant ON %I FOR ALL TO authenticated USING (fiberos_enterprise_tenant_ok(tenant_id)) WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id))',t,t);
  END LOOP;
END $$;

ALTER TABLE ftth_duct_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ftth_cable_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ftth_splices ENABLE ROW LEVEL SECURITY;
ALTER TABLE ftth_odn_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE ftth_construction_evidence ENABLE ROW LEVEL SECURITY;
COMMIT;
