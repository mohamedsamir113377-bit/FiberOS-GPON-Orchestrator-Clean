-- 149_reality_access_policies.sql
-- Tenant/company/site/service/asset source policy and acquisition decision ledger.
BEGIN;
CREATE TABLE IF NOT EXISTS reality_source_catalog(
 source_key text PRIMARY KEY,label text NOT NULL,authority_class text NOT NULL CHECK(authority_class IN('observed','measured','derived','declared','unverified','simulated')),
 capabilities text[] NOT NULL CHECK(cardinality(capabilities)>0),network_families text[] NOT NULL CHECK(cardinality(network_families)>0),
 requires_external_connection boolean NOT NULL DEFAULT false,requires_instrument_provenance boolean NOT NULL DEFAULT false,
 authoritative_numeric boolean NOT NULL DEFAULT false,proof_only boolean NOT NULL DEFAULT false,description text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO reality_source_catalog(source_key,label,authority_class,capabilities,network_families,requires_external_connection,requires_instrument_provenance,authoritative_numeric,proof_only,description) VALUES
('nms_rx','Read-only NMS RX','observed',ARRAY['rx_power_numeric'],ARRAY['gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber','wireless_backhaul','unknown'],true,false,true,false,'Buyer-authorized read-only NMS numeric RX.'),
('olt_read_only_rx','Read-only OLT RX','observed',ARRAY['rx_power_numeric'],ARRAY['gpon','xgs_pon','mixed_fttx','enterprise_fiber'],true,false,true,false,'Buyer-authorized read-only OLT numeric RX.'),
('nms_topology','Read-only NMS/OSS topology','observed',ARRAY['topology','service_path'],ARRAY['gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber','wireless_backhaul','unknown'],true,false,false,false,'Buyer-authorized topology/path facts.'),
('otdr_instrument','OTDR instrument trace','measured',ARRAY['otdr_trace'],ARRAY['gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber'],false,true,false,false,'Measured OTDR trace with instrument provenance.'),
('field_power_meter','Field optical power meter','measured',ARRAY['rx_power_numeric','rx_power_field_proof'],ARRAY['gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber'],false,true,true,false,'Measured field optical power.'),
('field_otdr_sor','Field OTDR SOR trace','measured',ARRAY['otdr_trace'],ARRAY['gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber'],false,true,false,false,'Measured SOR trace.'),
('field_power_photo','Technician power-meter photo','unverified',ARRAY['rx_power_field_proof','site_identity','gps_presence','physical_condition'],ARRAY['gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber'],false,false,false,true,'Visual/geo proof; never numeric RX authority.'),
('field_otdr_photo','Technician OTDR-screen photo','unverified',ARRAY['otdr_visual_proof','site_identity','gps_presence','physical_condition'],ARRAY['gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber'],false,false,false,true,'Visual OTDR proof; not a parsed trace.'),
('field_gps_photo','Geo-tagged technician photo','unverified',ARRAY['site_identity','gps_presence','physical_condition'],ARRAY['gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber','wireless_backhaul','unknown'],false,false,false,true,'Geo-tagged physical presence proof.'),
('field_photo','Technician field photo','unverified',ARRAY['physical_condition'],ARRAY['gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber','wireless_backhaul','unknown'],false,false,false,true,'Visual field condition evidence.'),
('offline_field_envelope','Offline field envelope','unverified',ARRAY['rx_power_field_proof','otdr_visual_proof','site_identity','gps_presence','physical_condition'],ARRAY['gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber','wireless_backhaul','unknown'],false,false,false,true,'Offline transport; server authority at sync.'),
('manual_declared','Manual declaration','declared',ARRAY['rx_power_field_proof','otdr_visual_proof','site_identity','physical_condition','customer_confirmation'],ARRAY['gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber','wireless_backhaul','unknown'],false,false,false,true,'Human declaration only.'),
('ai_simulated','AI simulated/advisory','simulated',ARRAY['rx_power_field_proof','otdr_visual_proof','topology','service_path','physical_condition'],ARRAY['gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber','wireless_backhaul','unknown'],false,false,false,true,'Simulation only; not operational evidence.')
ON CONFLICT(source_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fiberos_reality_catalog_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'REALITY_SOURCE_CATALOG_IMMUTABLE'; END; $$;
REVOKE ALL ON FUNCTION public.fiberos_reality_catalog_immutable() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_reality_source_catalog_immutable ON reality_source_catalog;
CREATE TRIGGER trg_reality_source_catalog_immutable BEFORE UPDATE OR DELETE ON reality_source_catalog FOR EACH ROW EXECUTE FUNCTION public.fiberos_reality_catalog_immutable();

CREATE TABLE IF NOT EXISTS reality_access_profiles(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,profile_key text NOT NULL,profile_name text NOT NULL,
 network_family text NOT NULL CHECK(network_family IN('gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber','wireless_backhaul','unknown')),
 access_mode text NOT NULL CHECK(access_mode IN('DIRECT_READ_ONLY','HYBRID','FIELD_ONLY','OFFLINE_FIELD','MANUAL_DECLARED')),
 allowed_sources text[] NOT NULL CHECK(cardinality(allowed_sources)>0),denied_sources text[] NOT NULL DEFAULT '{}',priority_sources text[] NOT NULL CHECK(cardinality(priority_sources)>0),capabilities text[] NOT NULL CHECK(cardinality(capabilities)>0),
 capability_source_priority jsonb NOT NULL DEFAULT '{}'::jsonb,require_authoritative_for_closure boolean NOT NULL DEFAULT true,requires_gps_for_field_proof boolean NOT NULL DEFAULT true,requires_photo_for_field_proof boolean NOT NULL DEFAULT true,requires_instrument_provenance_for_measured boolean NOT NULL DEFAULT true,offline_allowed boolean NOT NULL DEFAULT false,manual_allowed boolean NOT NULL DEFAULT false,active boolean NOT NULL DEFAULT true,configuration_version integer NOT NULL DEFAULT 1,
 created_by uuid,created_at timestamptz NOT NULL DEFAULT now(),updated_by uuid,updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,profile_key)
);
CREATE TABLE IF NOT EXISTS reality_access_bindings(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,scope_type text NOT NULL CHECK(scope_type IN('tenant','site','service','asset')),scope_key text NOT NULL,profile_id uuid NOT NULL REFERENCES reality_access_profiles(id) ON DELETE RESTRICT,active boolean NOT NULL DEFAULT true,created_by uuid,created_at timestamptz NOT NULL DEFAULT now(),updated_by uuid,updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,scope_type,scope_key)
);
CREATE TABLE IF NOT EXISTS reality_acquisition_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,profile_id uuid REFERENCES reality_access_profiles(id) ON DELETE SET NULL,request_key text NOT NULL,
 subject_type text NOT NULL CHECK(subject_type IN('ticket','incident','service_order','work_package','service','asset','fault','installation')),subject_id uuid,
 capability text NOT NULL CHECK(capability IN('rx_power_numeric','rx_power_field_proof','otdr_trace','otdr_visual_proof','topology','service_path','site_identity','physical_condition','gps_presence','installation_acceptance','fault_resolution','commercial_support','customer_confirmation')),
 network_family text NOT NULL CHECK(network_family IN('gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber','wireless_backhaul','unknown')),
 scope_type text NOT NULL,scope_key text NOT NULL,selected_source text REFERENCES reality_source_catalog(source_key),decision_status text NOT NULL CHECK(decision_status IN('selected','candidate','fallback_required','blocked','unknown')),authority_class text,fallback_chain text[] NOT NULL DEFAULT '{}',requested_sources text[] NOT NULL DEFAULT '{}',available_sources text[] NOT NULL DEFAULT '{}',source_reference text,evidence_refs text[] NOT NULL DEFAULT '{}',observed_at timestamptz,runtime_verification_status text NOT NULL DEFAULT 'UNVERIFIED_POLICY_SELECTION' CHECK(runtime_verification_status IN('VERIFIED_BY_ADAPTER','UNVERIFIED_POLICY_SELECTION','NOT_APPLICABLE')),selection_basis text NOT NULL DEFAULT 'POLICY_CONFIGURATION',details jsonb NOT NULL DEFAULT '{}'::jsonb,created_by uuid,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,request_key)
);

CREATE INDEX IF NOT EXISTS idx_reality_profiles_tenant ON reality_access_profiles(tenant_id,active);
CREATE INDEX IF NOT EXISTS idx_reality_bindings_scope ON reality_access_bindings(tenant_id,scope_type,scope_key,active);
CREATE INDEX IF NOT EXISTS idx_reality_acq_subject ON reality_acquisition_events(tenant_id,subject_type,subject_id,created_at DESC);

ALTER TABLE reality_access_profiles ENABLE ROW LEVEL SECURITY;ALTER TABLE reality_access_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE reality_access_bindings ENABLE ROW LEVEL SECURITY;ALTER TABLE reality_access_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE reality_acquisition_events ENABLE ROW LEVEL SECURITY;ALTER TABLE reality_acquisition_events FORCE ROW LEVEL SECURITY;
CREATE POLICY reality_profiles_select ON reality_access_profiles FOR SELECT TO authenticated USING(tenant_id=fiberos_current_tenant_id());
CREATE POLICY reality_profiles_write ON reality_access_profiles FOR ALL TO authenticated USING(tenant_id=fiberos_current_tenant_id() AND fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','sysadmin'])) WITH CHECK(tenant_id=fiberos_current_tenant_id() AND fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','sysadmin']));
CREATE POLICY reality_bindings_select ON reality_access_bindings FOR SELECT TO authenticated USING(tenant_id=fiberos_current_tenant_id());
CREATE POLICY reality_bindings_write ON reality_access_bindings FOR ALL TO authenticated USING(tenant_id=fiberos_current_tenant_id() AND fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','sysadmin'])) WITH CHECK(tenant_id=fiberos_current_tenant_id() AND fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','sysadmin']));
CREATE POLICY reality_acq_select ON reality_acquisition_events FOR SELECT TO authenticated USING(tenant_id=fiberos_current_tenant_id());
CREATE POLICY reality_acq_insert ON reality_acquisition_events FOR INSERT TO authenticated WITH CHECK(tenant_id=fiberos_current_tenant_id());

CREATE OR REPLACE FUNCTION public.fiberos_reality_acquisition_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'REALITY_ACQUISITION_EVENTS_IMMUTABLE'; END; $$;
REVOKE ALL ON FUNCTION public.fiberos_reality_acquisition_immutable() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_reality_acquisition_immutable ON reality_acquisition_events;
CREATE TRIGGER trg_reality_acquisition_immutable BEFORE UPDATE OR DELETE ON reality_acquisition_events FOR EACH ROW EXECUTE FUNCTION public.fiberos_reality_acquisition_immutable();

CREATE OR REPLACE FUNCTION public.fiberos_validate_reality_profile_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text; d record;
BEGIN
  IF NEW.manual_allowed AND NOT ('manual_declared'=ANY(NEW.allowed_sources)) THEN RAISE EXCEPTION 'MANUAL_ALLOWED_SOURCE_REQUIRED'; END IF;
  IF NEW.access_mode='OFFLINE_FIELD' AND NOT NEW.offline_allowed THEN RAISE EXCEPTION 'OFFLINE_NOT_ALLOWED'; END IF;
  FOREACH s IN ARRAY NEW.allowed_sources LOOP
    SELECT * INTO d FROM reality_source_catalog WHERE source_key=s;
    IF NOT FOUND THEN RAISE EXCEPTION 'REALITY_SOURCE_NOT_CATALOGED'; END IF;
    IF NEW.network_family NOT IN ('mixed_fttx','unknown') AND NOT (NEW.network_family=ANY(d.network_families)) THEN RAISE EXCEPTION 'REALITY_SOURCE_NETWORK_MISMATCH'; END IF;
  END LOOP;
  FOREACH s IN ARRAY NEW.priority_sources LOOP
    IF NOT (s=ANY(NEW.allowed_sources)) THEN RAISE EXCEPTION 'REALITY_PRIORITY_SOURCE_NOT_ALLOWED'; END IF;
  END LOOP;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.fiberos_validate_reality_profile_sources() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_reality_validate_profile_sources ON reality_access_profiles;
CREATE TRIGGER trg_reality_validate_profile_sources BEFORE INSERT OR UPDATE ON reality_access_profiles FOR EACH ROW EXECUTE FUNCTION public.fiberos_validate_reality_profile_sources();

CREATE OR REPLACE FUNCTION public.fiberos_validate_reality_binding_profile_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM reality_access_profiles p WHERE p.id=NEW.profile_id AND p.tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'TENANT_MISMATCH_REALITY_PROFILE_BINDING'; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.fiberos_validate_reality_binding_profile_tenant() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_reality_binding_profile_tenant ON reality_access_bindings;
CREATE TRIGGER trg_reality_binding_profile_tenant BEFORE INSERT OR UPDATE ON reality_access_bindings FOR EACH ROW EXECUTE FUNCTION public.fiberos_validate_reality_binding_profile_tenant();

CREATE OR REPLACE FUNCTION public.fiberos_validate_reality_acquisition_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.profile_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM reality_access_profiles p WHERE p.id=NEW.profile_id AND p.tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'TENANT_MISMATCH_REALITY_ACQUISITION_PROFILE'; END IF;
  IF NEW.selected_source IS NOT NULL AND NOT EXISTS(SELECT 1 FROM reality_source_catalog c WHERE c.source_key=NEW.selected_source) THEN RAISE EXCEPTION 'REALITY_SELECTED_SOURCE_UNKNOWN'; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.fiberos_validate_reality_acquisition_tenant() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_reality_acq_tenant ON reality_acquisition_events;
CREATE TRIGGER trg_reality_acq_tenant BEFORE INSERT ON reality_acquisition_events FOR EACH ROW EXECUTE FUNCTION public.fiberos_validate_reality_acquisition_tenant();

GRANT SELECT ON reality_source_catalog TO authenticated,fiberos_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON reality_access_profiles TO fiberos_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON reality_access_bindings TO fiberos_app;
GRANT SELECT,INSERT ON reality_acquisition_events TO fiberos_app;
COMMIT;
