-- R14.1 sovereign intelligence foundation.
-- Scope: Web AI / Sovereign GIS / Distributed Contact Center / Asset DNA contracts.
-- Security rule: no external inference, no AI execution authority, no secrets in application data.
BEGIN;

CREATE TABLE IF NOT EXISTS fiberos_web_ai_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  model_id text NOT NULL,
  model_version text NOT NULL,
  deployment_authority text NOT NULL DEFAULT 'FIBEROS_SELF_HOSTED' CHECK (deployment_authority = 'FIBEROS_SELF_HOSTED'),
  privacy_boundary text NOT NULL DEFAULT 'NO_EXTERNAL_INFERENCE' CHECK (privacy_boundary = 'NO_EXTERNAL_INFERENCE'),
  license_evidence boolean NOT NULL DEFAULT false,
  security_review text NOT NULL DEFAULT 'PENDING' CHECK (security_review IN ('PENDING','PASS','FAIL')),
  validation_evidence boolean NOT NULL DEFAULT false,
  artifact_sha256 text,
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','qualified','rejected','retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, model_id, model_version)
);

CREATE TABLE IF NOT EXISTS fiberos_web_ai_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  model_id uuid REFERENCES fiberos_web_ai_models(id) ON DELETE RESTRICT,
  surface text NOT NULL DEFAULT 'WEBSITE_ONLY' CHECK (surface = 'WEBSITE_ONLY'),
  authority text NOT NULL DEFAULT 'ADVISORY_ONLY' CHECK (authority = 'ADVISORY_ONLY'),
  execution_authorized boolean NOT NULL DEFAULT false CHECK (execution_authorized = false),
  request_sha256 text NOT NULL,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fiberos_asset_dna (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  asset_id uuid NOT NULL REFERENCES network_assets(id) ON DELETE RESTRICT,
  dna_version integer NOT NULL DEFAULT 1 CHECK (dna_version > 0),
  identity_kind text NOT NULL DEFAULT 'FIBEROS_ASSET_DNA' CHECK (identity_kind = 'FIBEROS_ASSET_DNA'),
  canonical_payload jsonb NOT NULL,
  payload_sha256 text NOT NULL,
  evidence_class text NOT NULL DEFAULT 'unverified' CHECK (evidence_class IN ('observed','measured','derived','client_declared','simulated','unverified')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, asset_id, dna_version),
  UNIQUE (tenant_id, asset_id, payload_sha256)
);

CREATE TABLE IF NOT EXISTS fiberos_gis_layer_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  layer_key text NOT NULL,
  layer_kind text NOT NULL CHECK (layer_kind IN ('NETWORK_ASSET','FIBER_CABLE','DUCT','ODN','OPTICAL','WORK_ORDER','EVIDENCE','IMPACT','CUSTOMER_SERVICE')),
  source_authority text NOT NULL DEFAULT 'FIBEROS_DATABASE' CHECK (source_authority = 'FIBEROS_DATABASE'),
  external_provider boolean NOT NULL DEFAULT false CHECK (external_provider = false),
  tile_contract text NOT NULL DEFAULT 'OGC_API_TILES',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','qualified','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, layer_key)
);

CREATE TABLE IF NOT EXISTS fiberos_contact_center_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  node_code text NOT NULL,
  region_code text NOT NULL,
  node_role text NOT NULL CHECK (node_role IN ('CONTROL_PLANE','MEDIA_PLANE')),
  admin_public boolean NOT NULL DEFAULT false CHECK (admin_public = false),
  encrypted_media_required boolean NOT NULL DEFAULT true CHECK (encrypted_media_required = true),
  endpoint_ref text,
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','qualified','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, node_code)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fiberos_web_ai_models','fiberos_web_ai_requests','fiberos_asset_dna','fiberos_gis_layer_registry','fiberos_contact_center_nodes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_tenant ON %I FOR ALL TO authenticated USING (fiberos_enterprise_tenant_ok(tenant_id)) WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id))', t, t);
  END LOOP;
END $$;


-- Explicit RLS declarations are kept alongside the dynamic policy block so static
-- security scanners can prove the tenant boundary without executing PL/pgSQL.
ALTER TABLE fiberos_web_ai_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiberos_web_ai_models FORCE ROW LEVEL SECURITY;
ALTER TABLE fiberos_web_ai_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiberos_web_ai_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE fiberos_asset_dna ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiberos_asset_dna FORCE ROW LEVEL SECURITY;
ALTER TABLE fiberos_gis_layer_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiberos_gis_layer_registry FORCE ROW LEVEL SECURITY;
ALTER TABLE fiberos_contact_center_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiberos_contact_center_nodes FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_web_ai_models_tenant_status ON fiberos_web_ai_models(tenant_id, status, model_id);
CREATE INDEX IF NOT EXISTS idx_web_ai_requests_tenant_created ON fiberos_web_ai_requests(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_dna_tenant_asset ON fiberos_asset_dna(tenant_id, asset_id, dna_version DESC);
CREATE INDEX IF NOT EXISTS idx_gis_layer_registry_tenant_kind ON fiberos_gis_layer_registry(tenant_id, layer_kind);
CREATE INDEX IF NOT EXISTS idx_cc_nodes_tenant_region ON fiberos_contact_center_nodes(tenant_id, region_code, node_role);

COMMIT;
