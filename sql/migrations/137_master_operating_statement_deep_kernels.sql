-- 137_master_operating_statement_deep_kernels.sql
-- FTTH CORE Master Operating Statement 2026-10-07
-- Source-backed implementation of the highest-value specification gaps.
-- Runtime certification remains separate: this migration must execute successfully
-- in the exact PostgreSQL 18/PostGIS 3.6/RLS environment before any runtime claim.
BEGIN;

-- ============================================================================
-- PHASE 1 — Canonical physical taxonomy
-- ============================================================================
CREATE TABLE IF NOT EXISTS network_asset_class_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  normalized_class text NOT NULL,
  display_name text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  parent_classes text[] NOT NULL DEFAULT '{}',
  semantic_type text NOT NULL CHECK (semantic_type IN ('PHYSICAL_ASSET','LOGICAL_RESOURCE','CUSTOMER_ENDPOINT','SERVICE_RESOURCE')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, normalized_class)
);
CREATE INDEX IF NOT EXISTS idx_asset_class_registry_lookup
  ON network_asset_class_registry(tenant_id, normalized_class, active);

-- The operator-facing names are aliases; network_assets remains the physical
-- legacy table, while this registry supplies a normalized semantic vocabulary.
CREATE TABLE IF NOT EXISTS network_asset_semantic_links (
  asset_id uuid PRIMARY KEY REFERENCES network_assets(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  class_registry_id uuid NOT NULL REFERENCES network_asset_class_registry(id) ON DELETE RESTRICT,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  UNIQUE (tenant_id, asset_id, class_registry_id),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX IF NOT EXISTS idx_asset_semantic_links_tenant_class
  ON network_asset_semantic_links(tenant_id, class_registry_id);

-- ============================================================================
-- PHASE 2 — Fibre/core continuity as a first-class invariant
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fiberos_guard_fiber_core_link_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  from_tenant uuid;
  to_tenant uuid;
  duplicate_count integer;
BEGIN
  IF NEW.from_core_id = NEW.to_core_id THEN
    RAISE EXCEPTION 'FIBER_CORE_SELF_LINK_FORBIDDEN' USING ERRCODE='22023';
  END IF;

  SELECT c.tenant_id INTO from_tenant
  FROM public.fiber_cores c WHERE c.id = NEW.from_core_id;
  SELECT c.tenant_id INTO to_tenant
  FROM public.fiber_cores c WHERE c.id = NEW.to_core_id;

  IF from_tenant IS NULL OR to_tenant IS NULL OR from_tenant <> NEW.tenant_id OR to_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'FIBER_CORE_LINK_TENANT_MISMATCH' USING ERRCODE='42501';
  END IF;

  IF NEW.status IN ('active','degrading') AND NEW.relation <> 'splitter_leg' THEN
    -- Transaction-scoped lock makes the check serialization-safe even when the
    -- application sends two concurrent mutations for the same endpoint.
    PERFORM pg_advisory_xact_lock(
      hashtextextended(coalesce(NEW.from_core_id::text,'') || '|' || coalesce(NEW.to_core_id::text,''), 13702026)
    );

    SELECT count(*) INTO duplicate_count
    FROM public.fiber_core_links f
    WHERE f.id <> NEW.id
      AND f.tenant_id = NEW.tenant_id
      AND f.status IN ('active','degrading')
      AND f.relation <> 'splitter_leg'
      AND (f.from_core_id = NEW.from_core_id OR f.to_core_id = NEW.to_core_id);

    IF duplicate_count > 0 THEN
      RAISE EXCEPTION 'FIBER_CORE_CONTINUITY_CONFLICT' USING ERRCODE='23505';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fiberos_guard_fiber_core_link_integrity() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_fiber_core_link_integrity ON public.fiber_core_links;
CREATE TRIGGER trg_fiber_core_link_integrity
BEFORE INSERT OR UPDATE ON public.fiber_core_links
FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_fiber_core_link_integrity();

CREATE OR REPLACE FUNCTION public.fiberos_guard_ftth_splice_core_range()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE a_count integer; b_count integer; a_tenant uuid; b_tenant uuid;
BEGIN
  SELECT c.fiber_count, c.tenant_id INTO a_count, a_tenant
  FROM public.ftth_cable_segments c WHERE c.id=NEW.cable_a_id;
  SELECT c.fiber_count, c.tenant_id INTO b_count, b_tenant
  FROM public.ftth_cable_segments c WHERE c.id=NEW.cable_b_id;
  IF a_count IS NULL OR b_count IS NULL OR a_tenant IS NULL OR b_tenant IS NULL
     OR a_tenant <> NEW.tenant_id OR b_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'SPLICE_CABLE_TENANT_MISMATCH' USING ERRCODE='42501';
  END IF;
  IF NEW.core_a > a_count OR NEW.core_b > b_count THEN
    RAISE EXCEPTION 'SPLICE_CORE_OUT_OF_RANGE' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fiberos_guard_ftth_splice_core_range() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_ftth_splice_core_range ON public.ftth_splices;
CREATE TRIGGER trg_ftth_splice_core_range
BEFORE INSERT OR UPDATE ON public.ftth_splices
FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_ftth_splice_core_range();

-- ============================================================================
-- PHASE 3 — Structured effective-dated service-path hops
-- ============================================================================
CREATE TABLE IF NOT EXISTS network_service_path_hops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  service_path_version_id uuid NOT NULL REFERENCES network_service_path_versions(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  from_asset_id uuid REFERENCES network_assets(id) ON DELETE RESTRICT,
  from_port_id uuid REFERENCES network_ports(id) ON DELETE RESTRICT,
  from_core_id uuid REFERENCES fiber_cores(id) ON DELETE RESTRICT,
  to_asset_id uuid REFERENCES network_assets(id) ON DELETE RESTRICT,
  to_port_id uuid REFERENCES network_ports(id) ON DELETE RESTRICT,
  to_core_id uuid REFERENCES fiber_cores(id) ON DELETE RESTRICT,
  relation text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  evidence_id uuid REFERENCES evidence(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, service_path_version_id, ordinal),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX IF NOT EXISTS idx_service_path_hops_lookup
  ON network_service_path_hops(tenant_id, service_path_version_id, ordinal);

ALTER TABLE network_service_path_versions
  ADD COLUMN IF NOT EXISTS path_is_projection boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN network_service_path_versions.path IS
  'Projection/cache only. Canonical service-path truth is represented by network_service_path_hops.';
COMMENT ON COLUMN network_service_path_versions.path_is_projection IS
  'Must remain true; structured hops are the source of truth, never free-text/JSON path content.';

-- Tenant-safe service-path hop references.
CREATE OR REPLACE FUNCTION public.fiberos_guard_service_path_hop_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE version_tenant uuid; service_tenant uuid; a_tenant uuid; p_tenant uuid; c_tenant uuid; e_tenant uuid;
BEGIN
  SELECT tenant_id INTO version_tenant FROM public.network_service_path_versions WHERE id=NEW.service_path_version_id;
  IF version_tenant IS NULL OR version_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'SERVICE_PATH_VERSION_TENANT_MISMATCH' USING ERRCODE='42501';
  END IF;

  SELECT tenant_id INTO service_tenant FROM public.services s
  JOIN public.network_service_path_versions v ON v.service_id=s.id
  WHERE v.id=NEW.service_path_version_id;
  IF service_tenant IS NULL OR service_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'SERVICE_PATH_SERVICE_TENANT_MISMATCH' USING ERRCODE='42501';
  END IF;

  IF NEW.from_asset_id IS NOT NULL THEN
    SELECT tenant_id INTO a_tenant FROM public.network_assets WHERE id=NEW.from_asset_id;
    IF a_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'SERVICE_PATH_FROM_ASSET_TENANT_MISMATCH'; END IF;
  END IF;
  IF NEW.to_asset_id IS NOT NULL THEN
    SELECT tenant_id INTO a_tenant FROM public.network_assets WHERE id=NEW.to_asset_id;
    IF a_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'SERVICE_PATH_TO_ASSET_TENANT_MISMATCH'; END IF;
  END IF;
  IF NEW.from_port_id IS NOT NULL THEN
    SELECT tenant_id INTO p_tenant FROM public.network_ports WHERE id=NEW.from_port_id;
    IF p_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'SERVICE_PATH_FROM_PORT_TENANT_MISMATCH'; END IF;
  END IF;
  IF NEW.to_port_id IS NOT NULL THEN
    SELECT tenant_id INTO p_tenant FROM public.network_ports WHERE id=NEW.to_port_id;
    IF p_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'SERVICE_PATH_TO_PORT_TENANT_MISMATCH'; END IF;
  END IF;
  IF NEW.from_core_id IS NOT NULL THEN
    SELECT tenant_id INTO c_tenant FROM public.fiber_cores WHERE id=NEW.from_core_id;
    IF c_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'SERVICE_PATH_FROM_CORE_TENANT_MISMATCH'; END IF;
  END IF;
  IF NEW.to_core_id IS NOT NULL THEN
    SELECT tenant_id INTO c_tenant FROM public.fiber_cores WHERE id=NEW.to_core_id;
    IF c_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'SERVICE_PATH_TO_CORE_TENANT_MISMATCH'; END IF;
  END IF;
  IF NEW.evidence_id IS NOT NULL THEN
    SELECT tenant_id INTO e_tenant FROM public.evidence WHERE id=NEW.evidence_id;
    IF e_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'SERVICE_PATH_EVIDENCE_TENANT_MISMATCH'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fiberos_guard_service_path_hop_tenant() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_service_path_hop_tenant ON public.network_service_path_hops;
CREATE TRIGGER trg_service_path_hop_tenant
BEFORE INSERT OR UPDATE ON public.network_service_path_hops
FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_service_path_hop_tenant();

-- ============================================================================
-- PHASE 4 — Common operational graph
-- ============================================================================
CREATE TABLE IF NOT EXISTS network_shared_graph_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  from_type text NOT NULL,
  from_id uuid NOT NULL,
  to_type text NOT NULL,
  to_id uuid NOT NULL,
  relation text NOT NULL,
  direction text NOT NULL DEFAULT 'DIRECTED' CHECK (direction IN ('DIRECTED','UNDIRECTED')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  work_package_id uuid REFERENCES ftth_work_packages(id) ON DELETE SET NULL,
  evidence_id uuid REFERENCES evidence(id) ON DELETE RESTRICT,
  source text NOT NULL,
  confidence numeric(5,4) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, from_type, from_id, to_type, to_id, relation, valid_from),
  CHECK (from_id <> to_id OR relation='SELF_REFERENCE_ALLOWED'),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX IF NOT EXISTS idx_shared_graph_from ON network_shared_graph_edges(tenant_id,from_type,from_id,valid_from DESC);
CREATE INDEX IF NOT EXISTS idx_shared_graph_to ON network_shared_graph_edges(tenant_id,to_type,to_id,valid_from DESC);

-- ============================================================================
-- PHASE 5 — Asset-specific lifecycle / acceptance gates
-- ============================================================================
CREATE TABLE IF NOT EXISTS network_asset_acceptance_gates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  entity_type text NOT NULL CHECK (entity_type IN ('FTTH_CABLE','FTTH_DUCT','ODN_CONNECTION','NETWORK_ASSET','SERVICE_PATH')),
  entity_id uuid NOT NULL,
  target_state text NOT NULL CHECK (target_state IN ('ACCEPTED','LIVE')),
  as_built_verified boolean NOT NULL DEFAULT false,
  test_verified boolean NOT NULL DEFAULT false,
  evidence_complete boolean NOT NULL DEFAULT false,
  qa_actor_id uuid,
  qa_at timestamptz,
  acceptance_notes text,
  gate_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,entity_type,entity_id,target_state)
);
CREATE INDEX IF NOT EXISTS idx_acceptance_gates_entity
  ON network_asset_acceptance_gates(tenant_id,entity_type,entity_id,target_state);

CREATE OR REPLACE FUNCTION public.fiberos_ftth_acceptance_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE et text; ok boolean;
BEGIN
  IF NEW.status NOT IN ('accepted','live') THEN RETURN NEW; END IF;
  et := CASE TG_TABLE_NAME
    WHEN 'ftth_cable_segments' THEN 'FTTH_CABLE'
    WHEN 'ftth_duct_segments' THEN 'FTTH_DUCT'
    WHEN 'ftth_odn_connections' THEN 'ODN_CONNECTION'
    ELSE NULL
  END;
  IF et IS NULL THEN RETURN NEW; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.network_asset_acceptance_gates g
    WHERE g.tenant_id=NEW.tenant_id AND g.entity_type=et AND g.entity_id=NEW.id
      AND g.target_state=upper(NEW.status)
      AND g.as_built_verified AND g.test_verified AND g.evidence_complete
      AND g.qa_actor_id IS NOT NULL AND g.qa_at IS NOT NULL
  ) INTO ok;

  IF NOT ok THEN
    RAISE EXCEPTION 'FTTH_ACCEPTANCE_GATE_REQUIRED:%:%', et, NEW.id USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fiberos_ftth_acceptance_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_ftth_cable_acceptance_gate ON public.ftth_cable_segments;
CREATE TRIGGER trg_ftth_cable_acceptance_gate
BEFORE INSERT OR UPDATE OF status ON public.ftth_cable_segments
FOR EACH ROW EXECUTE FUNCTION public.fiberos_ftth_acceptance_guard();
DROP TRIGGER IF EXISTS trg_ftth_duct_acceptance_gate ON public.ftth_duct_segments;
CREATE TRIGGER trg_ftth_duct_acceptance_gate
BEFORE INSERT OR UPDATE OF status ON public.ftth_duct_segments
FOR EACH ROW EXECUTE FUNCTION public.fiberos_ftth_acceptance_guard();
DROP TRIGGER IF EXISTS trg_ftth_odn_acceptance_gate ON public.ftth_odn_connections;
CREATE TRIGGER trg_ftth_odn_acceptance_gate
BEFORE INSERT OR UPDATE OF status ON public.ftth_odn_connections
FOR EACH ROW EXECUTE FUNCTION public.fiberos_ftth_acceptance_guard();

-- ============================================================================
-- PHASE 6 — Standards-aware telemetry boundary and OLT/NMS correlation
-- ============================================================================
CREATE TABLE IF NOT EXISTS network_telemetry_source_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  adapter_key text NOT NULL,
  protocol text NOT NULL CHECK (protocol IN ('SNMP','NETCONF','RESTCONF','YANG','STREAMING_TELEMETRY','SYSLOG','VENDOR_NBI','IMPORT')),
  vendor text,
  model text,
  endpoint_ref text,
  enabled boolean NOT NULL DEFAULT false,
  live_connected boolean NOT NULL DEFAULT false CHECK (live_connected = false),
  standards_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,adapter_key)
);

CREATE TABLE IF NOT EXISTS network_telemetry_correlations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  telemetry_source_id uuid NOT NULL REFERENCES network_telemetry_source_registry(id) ON DELETE RESTRICT,
  event_time timestamptz NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  port_id uuid REFERENCES network_ports(id) ON DELETE RESTRICT,
  service_id uuid REFERENCES services(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_id uuid REFERENCES evidence(id) ON DELETE RESTRICT,
  correlation_status text NOT NULL DEFAULT 'UNRESOLVED' CHECK (correlation_status IN ('UNRESOLVED','CORRELATED','CONFLICTED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_telemetry_corr_resource
  ON network_telemetry_correlations(tenant_id,resource_type,resource_id,event_time DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_corr_port
  ON network_telemetry_correlations(tenant_id,port_id,event_time DESC);

CREATE OR REPLACE FUNCTION public.fiberos_guard_telemetry_correlation_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE t uuid;
BEGIN
  SELECT tenant_id INTO t FROM public.network_telemetry_source_registry WHERE id=NEW.telemetry_source_id;
  IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'TELEMETRY_SOURCE_TENANT_MISMATCH'; END IF;
  IF NEW.port_id IS NOT NULL THEN
    SELECT tenant_id INTO t FROM public.network_ports WHERE id=NEW.port_id;
    IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'TELEMETRY_PORT_TENANT_MISMATCH'; END IF;
  END IF;
  IF NEW.service_id IS NOT NULL THEN
    SELECT tenant_id INTO t FROM public.services WHERE id=NEW.service_id;
    IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'TELEMETRY_SERVICE_TENANT_MISMATCH'; END IF;
  END IF;
  IF NEW.evidence_id IS NOT NULL THEN
    SELECT tenant_id INTO t FROM public.evidence WHERE id=NEW.evidence_id;
    IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'TELEMETRY_EVIDENCE_TENANT_MISMATCH'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fiberos_guard_telemetry_correlation_tenant() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_telemetry_correlation_tenant ON public.network_telemetry_correlations;
CREATE TRIGGER trg_telemetry_correlation_tenant
BEFORE INSERT OR UPDATE ON public.network_telemetry_correlations
FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_telemetry_correlation_tenant();

-- ============================================================================
-- DEEP REALITY — Evidence, authority, conflicts, replay, uncertainty
-- ============================================================================
ALTER TABLE network_reality_observations
  ADD COLUMN IF NOT EXISTS evidence_id uuid REFERENCES evidence(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS valid_from timestamptz,
  ADD COLUMN IF NOT EXISTS valid_to timestamptz,
  ADD COLUMN IF NOT EXISTS authority_class text,
  ADD COLUMN IF NOT EXISTS freshness timestamptz,
  ADD COLUMN IF NOT EXISTS uncertainty jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS conflict_set uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS verification_method text;
ALTER TABLE network_truth_claims
  ADD COLUMN IF NOT EXISTS authority_class text,
  ADD COLUMN IF NOT EXISTS proof_chain jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS freshness timestamptz,
  ADD COLUMN IF NOT EXISTS uncertainty jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS conflict_set uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_method text;

COMMENT ON COLUMN network_truth_claims.proof_chain IS
  'Ordered proof references: object -> relationship -> observation -> evidence -> actor/device -> time -> method -> measurement -> instrument -> calibration -> hash -> acceptance.';
COMMENT ON COLUMN network_reality_observations.authority_class IS
  'Deployment-specific authority classification; never treated as globally authoritative by this schema.';

CREATE TABLE IF NOT EXISTS network_authority_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  fact_class text NOT NULL,
  source_class text NOT NULL,
  precedence integer NOT NULL CHECK (precedence > 0),
  conflict_outcome text NOT NULL CHECK (conflict_outcome IN ('CONFLICTED','RECONCILE','REJECT')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  policy_version text NOT NULL,
  policy_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,fact_class,source_class,policy_version)
);

CREATE TABLE IF NOT EXISTS network_evidence_admissibility_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  claim_type text NOT NULL,
  from_evidence_class text NOT NULL CHECK (from_evidence_class IN ('observed','measured','derived','client_declared','simulated','unverified')),
  to_evidence_class text NOT NULL CHECK (to_evidence_class IN ('observed','measured','derived','client_declared','simulated','unverified')),
  requires_external_proof boolean NOT NULL DEFAULT true,
  allowed boolean NOT NULL DEFAULT false,
  policy_version text NOT NULL,
  rule_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,claim_type,from_evidence_class,to_evidence_class,policy_version)
);

CREATE TABLE IF NOT EXISTS network_truth_compilation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  fact_class text NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  observation_ids uuid[] NOT NULL DEFAULT '{}',
  selected_observation_id uuid,
  result_status text NOT NULL CHECK (result_status IN ('ADMISSIBLE','CONFLICTED','UNVERIFIED','REJECTED')),
  conflict_ids uuid[] NOT NULL DEFAULT '{}',
  authority_policy_version text,
  compiler_version text NOT NULL,
  input_hash char(64) NOT NULL,
  result_hash char(64) NOT NULL,
  compiled_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS network_truth_conflict_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  conflict_key text NOT NULL,
  subject_type text,
  subject_id uuid,
  source_classes text[] NOT NULL DEFAULT '{}',
  observation_ids uuid[] NOT NULL DEFAULT '{}',
  resolution_status text NOT NULL DEFAULT 'OPEN' CHECK (resolution_status IN ('OPEN','RESOLVED','REJECTED','WAIVED')),
  rationale text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS network_fault_hypotheses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  hypothesis text NOT NULL,
  epistemic_status text NOT NULL CHECK (epistemic_status IN ('CAUSALLY_CONFIRMED','CORRELATED','SUSPECTED','REJECTED','UNKNOWN')),
  confidence numeric(5,4) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  supporting_evidence_ids uuid[] NOT NULL DEFAULT '{}',
  contradicting_evidence_ids uuid[] NOT NULL DEFAULT '{}',
  field_test_evidence_ids uuid[] NOT NULL DEFAULT '{}',
  model_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS network_uncertainty_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  truth_state text NOT NULL CHECK (truth_state IN ('CONFIRMED','PROBABLE','CORRELATED','UNVERIFIED','CONFLICTED','STALE','UNKNOWN')),
  authority_class text,
  evidence_ids uuid[] NOT NULL DEFAULT '{}',
  freshness timestamptz,
  measurement_uncertainty jsonb NOT NULL DEFAULT '{}'::jsonb,
  conflict_set uuid[] NOT NULL DEFAULT '{}',
  verification_method text,
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Evidence reference on an observation is tenant-safe.
CREATE OR REPLACE FUNCTION public.fiberos_guard_reality_observation_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE t uuid;
BEGIN
  IF NEW.evidence_id IS NOT NULL THEN
    SELECT tenant_id INTO t FROM public.evidence WHERE id=NEW.evidence_id;
    IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'REALITY_OBSERVATION_EVIDENCE_TENANT_MISMATCH'; END IF;
  END IF;
  IF NEW.asset_id IS NOT NULL THEN
    SELECT tenant_id INTO t FROM public.network_assets WHERE id=NEW.asset_id;
    IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'REALITY_OBSERVATION_ASSET_TENANT_MISMATCH'; END IF;
  END IF;
  IF NEW.service_id IS NOT NULL THEN
    SELECT tenant_id INTO t FROM public.services WHERE id=NEW.service_id;
    IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'REALITY_OBSERVATION_SERVICE_TENANT_MISMATCH'; END IF;
  END IF;
  IF NEW.valid_to IS NOT NULL AND NEW.valid_to <= NEW.valid_from THEN
    RAISE EXCEPTION 'REALITY_OBSERVATION_INVALID_VALIDITY_RANGE' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fiberos_guard_reality_observation_tenant() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_reality_observation_tenant ON public.network_reality_observations;
CREATE TRIGGER trg_reality_observation_tenant
BEFORE INSERT OR UPDATE ON public.network_reality_observations
FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_reality_observation_tenant();

-- ============================================================================
-- PHASE 9 — Building / riser / floor / unit hierarchy
-- ============================================================================
CREATE TABLE IF NOT EXISTS ftth_buildings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  building_code text NOT NULL,
  name text,
  address text,
  geometry geometry(Point,4326),
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','ACTIVE','RETIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,building_code)
);
CREATE TABLE IF NOT EXISTS ftth_floors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  building_id uuid NOT NULL REFERENCES ftth_buildings(id) ON DELETE RESTRICT,
  floor_no integer NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,building_id,floor_no)
);
CREATE TABLE IF NOT EXISTS ftth_risers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  building_id uuid NOT NULL REFERENCES ftth_buildings(id) ON DELETE RESTRICT,
  riser_code text NOT NULL,
  shaft_reference text,
  access_constraint text,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','ACTIVE','RETIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,building_id,riser_code)
);
CREATE TABLE IF NOT EXISTS ftth_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  building_id uuid NOT NULL REFERENCES ftth_buildings(id) ON DELETE RESTRICT,
  floor_id uuid REFERENCES ftth_floors(id) ON DELETE RESTRICT,
  unit_code text NOT NULL,
  assignment_state text NOT NULL DEFAULT 'PLANNED' CHECK (assignment_state IN ('PLANNED','RESERVED','PHYSICALLY_CONNECTED','SERVICE_ACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,building_id,unit_code)
);
CREATE TABLE IF NOT EXISTS ftth_riser_boxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  building_id uuid NOT NULL REFERENCES ftth_buildings(id) ON DELETE RESTRICT,
  floor_id uuid REFERENCES ftth_floors(id) ON DELETE RESTRICT,
  riser_id uuid REFERENCES ftth_risers(id) ON DELETE RESTRICT,
  box_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,building_id,box_code)
);
CREATE INDEX IF NOT EXISTS idx_ftth_units_building_floor ON ftth_units(tenant_id,building_id,floor_id,assignment_state);
CREATE INDEX IF NOT EXISTS idx_ftth_riser_boxes_riser ON ftth_riser_boxes(tenant_id,riser_id,floor_id);

CREATE OR REPLACE FUNCTION public.fiberos_guard_mdu_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE t uuid;
BEGIN
  IF TG_TABLE_NAME='ftth_floors' THEN
    SELECT tenant_id INTO t FROM public.ftth_buildings WHERE id=NEW.building_id;
    IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'FLOOR_BUILDING_TENANT_MISMATCH'; END IF;
  ELSIF TG_TABLE_NAME='ftth_risers' THEN
    SELECT tenant_id INTO t FROM public.ftth_buildings WHERE id=NEW.building_id;
    IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'RISER_BUILDING_TENANT_MISMATCH'; END IF;
  ELSIF TG_TABLE_NAME='ftth_units' THEN
    SELECT tenant_id INTO t FROM public.ftth_buildings WHERE id=NEW.building_id;
    IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'UNIT_BUILDING_TENANT_MISMATCH'; END IF;
    IF NEW.floor_id IS NOT NULL THEN
      SELECT tenant_id INTO t FROM public.ftth_floors WHERE id=NEW.floor_id AND building_id=NEW.building_id;
      IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'UNIT_FLOOR_TENANT_MISMATCH'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME='ftth_riser_boxes' THEN
    SELECT tenant_id INTO t FROM public.ftth_buildings WHERE id=NEW.building_id;
    IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'RISER_BOX_BUILDING_TENANT_MISMATCH'; END IF;
    IF NEW.floor_id IS NOT NULL THEN
      SELECT tenant_id INTO t FROM public.ftth_floors WHERE id=NEW.floor_id AND building_id=NEW.building_id;
      IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'RISER_BOX_FLOOR_TENANT_MISMATCH'; END IF;
    END IF;
    IF NEW.riser_id IS NOT NULL THEN
      SELECT tenant_id INTO t FROM public.ftth_risers WHERE id=NEW.riser_id AND building_id=NEW.building_id;
      IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'RISER_BOX_RISER_TENANT_MISMATCH'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fiberos_guard_mdu_tenant() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_ftth_floors_tenant ON ftth_floors;
CREATE TRIGGER trg_ftth_floors_tenant BEFORE INSERT OR UPDATE ON ftth_floors FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_mdu_tenant();
DROP TRIGGER IF EXISTS trg_ftth_risers_tenant ON ftth_risers;
CREATE TRIGGER trg_ftth_risers_tenant BEFORE INSERT OR UPDATE ON ftth_risers FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_mdu_tenant();
DROP TRIGGER IF EXISTS trg_ftth_units_tenant ON ftth_units;
CREATE TRIGGER trg_ftth_units_tenant BEFORE INSERT OR UPDATE ON ftth_units FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_mdu_tenant();
DROP TRIGGER IF EXISTS trg_ftth_riser_boxes_tenant ON ftth_riser_boxes;
CREATE TRIGGER trg_ftth_riser_boxes_tenant BEFORE INSERT OR UPDATE ON ftth_riser_boxes FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_mdu_tenant();

-- ============================================================================
-- PHASE 10 — Civil / duct / underground safety and third-party risk
-- ============================================================================
CREATE TABLE IF NOT EXISTS ftth_civil_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  duct_id uuid REFERENCES ftth_duct_segments(id) ON DELETE RESTRICT,
  work_package_id uuid REFERENCES ftth_work_packages(id) ON DELETE SET NULL,
  inspection_type text NOT NULL CHECK (inspection_type IN ('UTILITY_CLEARANCE','SOIL','TRENCH','TRENCHLESS','DUCT','REINSTATEMENT','GNSS_MAPPING')),
  method text,
  planned_depth_m numeric(8,3),
  observed_depth_m numeric(8,3),
  condition text,
  geometry geometry(LineString,4326),
  captured_at timestamptz NOT NULL,
  actor_id uuid,
  evidence_id uuid REFERENCES evidence(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ftth_civil_inspections_work ON ftth_civil_inspections(tenant_id,work_package_id,captured_at DESC);

CREATE TABLE IF NOT EXISTS ftth_civil_corridor_risk (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  corridor_key text NOT NULL,
  cable_duct_importance numeric(8,3) NOT NULL DEFAULT 0 CHECK (cable_duct_importance >= 0),
  customer_impact numeric(8,3) NOT NULL DEFAULT 0 CHECK (customer_impact >= 0),
  road_utility_density numeric(8,3) NOT NULL DEFAULT 0 CHECK (road_utility_density >= 0),
  third_party_cut_history numeric(8,3) NOT NULL DEFAULT 0 CHECK (third_party_cut_history >= 0),
  access_difficulty numeric(8,3) NOT NULL DEFAULT 0 CHECK (access_difficulty >= 0),
  no_backup_status numeric(8,3) NOT NULL DEFAULT 0 CHECK (no_backup_status >= 0),
  risk_score numeric(12,3) GENERATED ALWAYS AS (
    cable_duct_importance + customer_impact + road_utility_density +
    third_party_cut_history + access_difficulty + no_backup_status
  ) STORED,
  assessed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,corridor_key)
);

-- ============================================================================
-- PHASE 11 — Continuous self-audit
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fiberos_run_network_integrity_scan(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  findings integer := 0;
BEGIN
  IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'INTEGRITY_SCAN_TENANT_REQUIRED'; END IF;

  INSERT INTO public.network_integrity_findings(tenant_id,finding_code,severity,subject_type,subject_id,details)
  SELECT p_tenant_id,'SERVICE_WITHOUT_LIVE_PATH','CRITICAL','SERVICE',s.id,
         jsonb_build_object('service_id',s.id)
  FROM public.services s
  WHERE s.tenant_id=p_tenant_id AND s.is_active=true
    AND NOT EXISTS (
      SELECT 1 FROM public.network_service_path_versions v
      WHERE v.tenant_id=p_tenant_id AND v.service_id=s.id AND v.state='live'
        AND v.valid_from <= now() AND (v.valid_to IS NULL OR now() < v.valid_to)
    )
  ON CONFLICT (tenant_id,finding_code,subject_type,subject_id)
  DO UPDATE SET details=excluded.details, detected_at=now(), resolved_at=NULL;

  INSERT INTO public.network_integrity_findings(tenant_id,finding_code,severity,subject_type,subject_id,details)
  SELECT p_tenant_id,'ASSET_MISSING_PARENT','HIGH','NETWORK_ASSET',a.id,
         jsonb_build_object('parent_asset_id',a.parent_asset_id)
  FROM public.network_assets a
  WHERE a.tenant_id=p_tenant_id AND a.parent_asset_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.network_assets p WHERE p.id=a.parent_asset_id AND p.tenant_id=p_tenant_id)
  ON CONFLICT (tenant_id,finding_code,subject_type,subject_id)
  DO UPDATE SET details=excluded.details, detected_at=now(), resolved_at=NULL;

  INSERT INTO public.network_integrity_findings(tenant_id,finding_code,severity,subject_type,subject_id,details)
  SELECT p_tenant_id,'ACCEPTED_CABLE_WITHOUT_GATE','CRITICAL','FTTH_CABLE',c.id,
         jsonb_build_object('status',c.status)
  FROM public.ftth_cable_segments c
  WHERE c.tenant_id=p_tenant_id AND c.status IN ('accepted','live')
    AND NOT EXISTS (
      SELECT 1 FROM public.network_asset_acceptance_gates g
      WHERE g.tenant_id=c.tenant_id AND g.entity_type='FTTH_CABLE' AND g.entity_id=c.id
        AND g.target_state=upper(c.status) AND g.as_built_verified AND g.test_verified AND g.evidence_complete
    )
  ON CONFLICT (tenant_id,finding_code,subject_type,subject_id)
  DO UPDATE SET details=excluded.details, detected_at=now(), resolved_at=NULL;

  INSERT INTO public.network_integrity_findings(tenant_id,finding_code,severity,subject_type,subject_id,details)
  SELECT p_tenant_id,'CAPACITY_CONTRADICTION','HIGH','NETWORK_ASSET',v.asset_id,
         jsonb_build_object('total_ports',v.total_ports,'used_ports',v.used_ports,'provisioned_ports',v.provisioned_ports)
  FROM public.network_asset_capacity v
  JOIN public.network_assets a ON a.id=v.asset_id
  WHERE a.tenant_id=p_tenant_id AND v.over_capacity=true
  ON CONFLICT (tenant_id,finding_code,subject_type,subject_id)
  DO UPDATE SET details=excluded.details, detected_at=now(), resolved_at=NULL;

  GET DIAGNOSTICS findings = ROW_COUNT;
  RETURN jsonb_build_object('tenant_id',p_tenant_id,'scan_completed',true,'last_statement_findings',findings,'timestamp',clock_timestamp());
END;
$$;
REVOKE ALL ON FUNCTION public.fiberos_run_network_integrity_scan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiberos_run_network_integrity_scan(uuid) TO fiberos_worker;

-- ============================================================================
-- PHASE 12 — Shared-risk / capacity / counterfactuals
-- ============================================================================
CREATE TABLE IF NOT EXISTS network_failure_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  domain_key text NOT NULL,
  criticality numeric(8,3) NOT NULL DEFAULT 0 CHECK (criticality >= 0),
  protection_class text,
  alternative_path_available boolean NOT NULL DEFAULT false,
  failure_probability numeric(8,6) CHECK (failure_probability IS NULL OR failure_probability BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,domain_key)
);

CREATE TABLE IF NOT EXISTS network_failure_domain_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  failure_domain_id uuid NOT NULL REFERENCES network_failure_domains(id) ON DELETE CASCADE,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  role text,
  UNIQUE (tenant_id,failure_domain_id,resource_type,resource_id)
);
CREATE INDEX IF NOT EXISTS idx_failure_domain_members_resource
  ON network_failure_domain_members(tenant_id,resource_type,resource_id);

CREATE TABLE IF NOT EXISTS network_capacity_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  scenario_key text NOT NULL,
  scenario_type text NOT NULL CHECK (scenario_type IN ('ADD_SPLITTER','ADD_CABINET','ADD_FEEDER','RECONFIGURE','NEW_ROUTE')),
  baseline_hash char(64) NOT NULL,
  hypothetical_delta jsonb NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  live_mutated boolean NOT NULL DEFAULT false CHECK (live_mutated=false),
  status text NOT NULL DEFAULT 'SIMULATED' CHECK (status IN ('SIMULATED','APPROVED','REJECTED','EXPIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,scenario_key)
);

CREATE OR REPLACE VIEW public.network_derived_capacity
WITH (security_invoker=true)
AS
SELECT
  a.id AS asset_id,
  a.tenant_id,
  a.asset_code,
  a.asset_type,
  a.total_ports,
  count(p.id) FILTER (WHERE p.status='used')::integer AS active_count,
  count(p.id) FILTER (WHERE p.status='reserved')::integer AS reserved_count,
  count(p.id) FILTER (WHERE p.status='faulty')::integer AS faulty_count,
  greatest(
    coalesce(a.total_ports,0)
    - count(p.id) FILTER (WHERE p.status IN ('used','reserved','faulty')),
    0
  )::integer AS available_count
FROM public.network_assets a
LEFT JOIN public.network_ports p ON p.asset_id=a.id AND p.tenant_id=a.tenant_id
GROUP BY a.id,a.tenant_id,a.asset_code,a.asset_type,a.total_ports;

-- ============================================================================
-- PROOF-CARRYING CONTROL / SAFETY BUDGET / REPLAY / CLAIMS
-- ============================================================================
ALTER TABLE network_authorized_commands
  ADD COLUMN IF NOT EXISTS request_hash char(64),
  ADD COLUMN IF NOT EXISTS target_version bigint,
  ADD COLUMN IF NOT EXISTS intent text,
  ADD COLUMN IF NOT EXISTS expected_impact jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS required_evidence uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS rollback_plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS policy_decision jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS execution_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS postconditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS proof_references jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE network_authorized_commands
  DROP CONSTRAINT IF EXISTS network_authorized_commands_request_hash_ck;
ALTER TABLE network_authorized_commands
  ADD CONSTRAINT network_authorized_commands_request_hash_ck
  CHECK (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$');

CREATE OR REPLACE FUNCTION public.fiberos_authorized_command_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status IN ('authorized','executing','verified') THEN
    IF nullif(NEW.authorization_ref,'') IS NULL OR nullif(NEW.policy_ref,'') IS NULL THEN
      RAISE EXCEPTION 'COMMAND_AUTHORIZATION_POLICY_REQUIRED' USING ERRCODE='42501';
    END IF;
  END IF;
  IF NEW.status='verified' THEN
    IF jsonb_array_length(coalesce(NEW.proof_references,'[]'::jsonb)) < 1
       OR jsonb_array_length(coalesce(NEW.postconditions,'[]'::jsonb)) < 1
       OR nullif(NEW.execution_result->>'result_hash','') IS NULL THEN
      RAISE EXCEPTION 'COMMAND_VERIFIED_POST_PROOF_REQUIRED' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fiberos_authorized_command_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_network_authorized_command_guard ON public.network_authorized_commands;
CREATE TRIGGER trg_network_authorized_command_guard
BEFORE INSERT OR UPDATE ON public.network_authorized_commands
FOR EACH ROW EXECUTE FUNCTION public.fiberos_authorized_command_guard();

CREATE TABLE IF NOT EXISTS network_replay_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  sequence_no bigint NOT NULL,
  event_time timestamptz NOT NULL,
  actor_id uuid,
  policy_version text,
  command_id uuid,
  state_hash char(64),
  evidence_ids uuid[] NOT NULL DEFAULT '{}',
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,sequence_no)
);
CREATE INDEX IF NOT EXISTS idx_replay_events_timeline
  ON network_replay_events(tenant_id,event_time,sequence_no);

CREATE TABLE IF NOT EXISTS network_capability_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  claim_id text NOT NULL,
  capability text NOT NULL,
  source_reference text NOT NULL,
  test_reference text,
  ci_reference text,
  runtime_requirement text,
  proof_date timestamptz,
  status text NOT NULL CHECK (status IN (
    'IMPLEMENTED','CI-VERIFIED','RUNTIME-VERIFIED','REFERENCE-VERIFIED',
    'BUYER-ENVIRONMENT-REQUIRED','DESIGN-ONLY','NOT-IMPLEMENTED'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,claim_id)
);

-- ============================================================================
-- RLS / FORCE RLS for all new tenant-scoped tables
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'network_asset_class_registry','network_asset_semantic_links',
    'network_service_path_hops','network_shared_graph_edges',
    'network_asset_acceptance_gates','network_telemetry_source_registry',
    'network_telemetry_correlations','network_authority_policies',
    'network_evidence_admissibility_rules','network_truth_compilation_runs',
    'network_truth_conflict_events','network_fault_hypotheses',
    'network_uncertainty_assessments','ftth_buildings','ftth_floors',
    'ftth_risers','ftth_units','ftth_riser_boxes','ftth_civil_inspections',
    'ftth_civil_corridor_risk','network_failure_domains',
    'network_failure_domain_members','network_capacity_scenarios',
    'network_replay_events','network_capability_claims'
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

-- Append-only truth/control history.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'network_truth_compilation_runs','network_truth_conflict_events',
    'network_fault_hypotheses','network_uncertainty_assessments',
    'network_replay_events','network_capability_claims'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_immutable ON public.%I',t,t);
    EXECUTE format('CREATE TRIGGER trg_%s_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fiberos_reject_history_mutation()',t,t);
  END LOOP;
END $$;

COMMIT;
