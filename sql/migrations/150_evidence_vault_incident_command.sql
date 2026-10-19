-- 150_evidence_vault_incident_command.sql
-- Immutable evidence metadata, explicit incident graph, and factual impact snapshots.
BEGIN;

CREATE TABLE IF NOT EXISTS evidence_vault_objects(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
 request_key text NOT NULL,
 evidence_class text NOT NULL CHECK(evidence_class IN('PHOTO','GPS','RX_READING','OTDR_SOR','OTDR_PHOTO','DOCUMENT','ACCEPTANCE','QC','INVOICE_SUPPORT','PROVIDER_CALLBACK')),
 source_path text NOT NULL REFERENCES reality_source_catalog(source_key),
 content_sha256 char(64) NOT NULL CHECK(content_sha256~'^[0-9a-fA-F]{64}$'),
 storage_status text NOT NULL DEFAULT 'CLIENT_HASH_ONLY' CHECK(storage_status IN('CLIENT_HASH_ONLY','STORAGE_UNVERIFIED','STORAGE_VERIFIED','STORAGE_MISSING','HASH_MISMATCH')),
 storage_reference text,captured_at timestamptz NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),
 actor_id uuid,device_id text,geo geography(Point,4326),provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
 verification_method text,provider_verified_sha256 char(64),provider_verified_at timestamptz,retention_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,request_key)
);
CREATE INDEX IF NOT EXISTS idx_evidence_vault_hash ON evidence_vault_objects(tenant_id,content_sha256);
CREATE INDEX IF NOT EXISTS idx_evidence_vault_time ON evidence_vault_objects(tenant_id,captured_at DESC);

ALTER TABLE evidence_vault_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_vault_objects FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_vault_select ON evidence_vault_objects FOR SELECT TO authenticated USING(tenant_id=fiberos_current_tenant_id());
CREATE POLICY evidence_vault_insert ON evidence_vault_objects FOR INSERT TO authenticated WITH CHECK(tenant_id=fiberos_current_tenant_id() AND storage_status<>'STORAGE_VERIFIED');
CREATE POLICY evidence_vault_update ON evidence_vault_objects FOR UPDATE TO authenticated USING(tenant_id=fiberos_current_tenant_id() AND fiberos_has_any_role(ARRAY['qc','ops_manager','sysadmin'])) WITH CHECK(tenant_id=fiberos_current_tenant_id() AND fiberos_has_any_role(ARRAY['qc','ops_manager','sysadmin']));

CREATE OR REPLACE FUNCTION public.fiberos_evidence_vault_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.evidence_class IS DISTINCT FROM NEW.evidence_class OR OLD.source_path IS DISTINCT FROM NEW.source_path OR OLD.content_sha256 IS DISTINCT FROM NEW.content_sha256 OR OLD.captured_at IS DISTINCT FROM NEW.captured_at OR OLD.actor_id IS DISTINCT FROM NEW.actor_id OR OLD.device_id IS DISTINCT FROM NEW.device_id OR OLD.geo IS DISTINCT FROM NEW.geo OR OLD.provenance IS DISTINCT FROM NEW.provenance OR OLD.request_key IS DISTINCT FROM NEW.request_key THEN RAISE EXCEPTION 'EVIDENCE_VAULT_CORE_METADATA_IMMUTABLE'; END IF;
 IF NEW.storage_status='STORAGE_VERIFIED' AND current_setting('fiberos.evidence_provider_verified',true)<>'1' THEN RAISE EXCEPTION 'EVIDENCE_VAULT_PROVIDER_VERIFICATION_REQUIRED'; END IF;
 IF NEW.storage_status='STORAGE_VERIFIED' AND (NEW.provider_verified_sha256 IS NULL OR NEW.provider_verified_sha256<>NEW.content_sha256) THEN RAISE EXCEPTION 'EVIDENCE_VAULT_VERIFIED_HASH_MISMATCH'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.fiberos_evidence_vault_immutable() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_evidence_vault_immutable ON evidence_vault_objects;
CREATE TRIGGER trg_evidence_vault_immutable BEFORE UPDATE ON evidence_vault_objects FOR EACH ROW EXECUTE FUNCTION public.fiberos_evidence_vault_immutable();
CREATE OR REPLACE FUNCTION public.fiberos_evidence_vault_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'EVIDENCE_VAULT_DELETE_FORBIDDEN'; END; $$;
REVOKE ALL ON FUNCTION public.fiberos_evidence_vault_no_delete() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_evidence_vault_no_delete ON evidence_vault_objects;
CREATE TRIGGER trg_evidence_vault_no_delete BEFORE DELETE ON evidence_vault_objects FOR EACH ROW EXECUTE FUNCTION public.fiberos_evidence_vault_no_delete();

CREATE TABLE IF NOT EXISTS evidence_vault_links(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
 evidence_vault_id uuid NOT NULL REFERENCES evidence_vault_objects(id) ON DELETE RESTRICT,
 entity_type text NOT NULL CHECK(entity_type IN('incident','ticket','service','service_order','work_package','measurement','reconciliation','fault','installation','asset')),
 entity_id uuid NOT NULL,link_role text NOT NULL DEFAULT 'supporting' CHECK(link_role IN('primary','supporting','acceptance','qc','commercial','timeline')),
 created_by uuid,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,evidence_vault_id,entity_type,entity_id,link_role)
);
CREATE INDEX IF NOT EXISTS idx_evidence_vault_links_entity ON evidence_vault_links(tenant_id,entity_type,entity_id,created_at DESC);
ALTER TABLE evidence_vault_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_vault_links FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_vault_links_select ON evidence_vault_links FOR SELECT TO authenticated USING(tenant_id=fiberos_current_tenant_id());
CREATE POLICY evidence_vault_links_insert ON evidence_vault_links FOR INSERT TO authenticated WITH CHECK(tenant_id=fiberos_current_tenant_id());

CREATE OR REPLACE FUNCTION public.fiberos_reality_entity_tenant_ok(p_type text,p_id uuid,p_tenant uuid) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,auth AS $$
BEGIN
 IF p_type='incident' THEN RETURN EXISTS(SELECT 1 FROM incidents WHERE id=p_id AND tenant_id=p_tenant);
 ELSIF p_type='ticket' THEN RETURN EXISTS(SELECT 1 FROM tickets WHERE id=p_id AND tenant_id=p_tenant);
 ELSIF p_type='service' THEN RETURN EXISTS(SELECT 1 FROM services WHERE id=p_id AND tenant_id=p_tenant);
 ELSIF p_type='service_order' THEN RETURN EXISTS(SELECT 1 FROM portal_service_orders WHERE id=p_id AND tenant_id=p_tenant);
 ELSIF p_type='work_package' THEN RETURN EXISTS(SELECT 1 FROM ftth_work_packages WHERE id=p_id AND tenant_id=p_tenant);
 ELSIF p_type='measurement' THEN RETURN EXISTS(SELECT 1 FROM contractor_work_measurements WHERE id=p_id AND tenant_id=p_tenant);
 ELSIF p_type='reconciliation' THEN RETURN EXISTS(SELECT 1 FROM commercial_measurement_reconciliation WHERE id=p_id AND tenant_id=p_tenant);
 ELSIF p_type='fault' THEN RETURN EXISTS(SELECT 1 FROM fault_jobs WHERE id=p_id AND tenant_id=p_tenant);
 ELSIF p_type='installation' THEN RETURN EXISTS(SELECT 1 FROM installation_jobs WHERE id=p_id AND tenant_id=p_tenant);
 ELSIF p_type='asset' THEN RETURN EXISTS(SELECT 1 FROM network_assets WHERE id=p_id AND tenant_id=p_tenant);
 END IF; RETURN false;
END; $$;
REVOKE ALL ON FUNCTION public.fiberos_reality_entity_tenant_ok(text,uuid,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.fiberos_guard_evidence_vault_link_scope() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,auth AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM evidence_vault_objects WHERE id=NEW.evidence_vault_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'TENANT_MISMATCH_EVIDENCE_VAULT'; END IF;
 IF NOT public.fiberos_reality_entity_tenant_ok(NEW.entity_type,NEW.entity_id,NEW.tenant_id) THEN RAISE EXCEPTION 'TENANT_MISMATCH_EVIDENCE_VAULT_ENTITY'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.fiberos_guard_evidence_vault_link_scope() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_evidence_vault_link_scope ON evidence_vault_links;
CREATE TRIGGER trg_evidence_vault_link_scope BEFORE INSERT OR UPDATE OF evidence_vault_id,entity_type,entity_id,tenant_id ON evidence_vault_links FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_evidence_vault_link_scope();
CREATE OR REPLACE FUNCTION public.fiberos_reality_append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'REALITY_APPEND_ONLY'; END; $$;
REVOKE ALL ON FUNCTION public.fiberos_reality_append_only_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_evidence_vault_links_no_delete ON evidence_vault_links;
CREATE TRIGGER trg_evidence_vault_links_no_delete BEFORE DELETE OR UPDATE ON evidence_vault_links FOR EACH ROW EXECUTE FUNCTION public.fiberos_reality_append_only_guard();

CREATE TABLE IF NOT EXISTS incident_command_links(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE RESTRICT,
 entity_type text NOT NULL CHECK(entity_type IN('ticket','service','service_order','work_package','asset','fault','installation','measurement','reconciliation')),
 entity_id uuid NOT NULL,link_role text NOT NULL DEFAULT 'supporting' CHECK(link_role IN('primary','supporting','affected','dispatch','commercial','evidence')),
 created_by uuid,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,incident_id,entity_type,entity_id,link_role)
);
ALTER TABLE incident_command_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_command_links FORCE ROW LEVEL SECURITY;
CREATE POLICY incident_command_links_select ON incident_command_links FOR SELECT TO authenticated USING(tenant_id=fiberos_current_tenant_id());
CREATE POLICY incident_command_links_insert ON incident_command_links FOR INSERT TO authenticated WITH CHECK(tenant_id=fiberos_current_tenant_id() AND fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','dispatcher','sysadmin']));
CREATE OR REPLACE FUNCTION public.fiberos_guard_incident_command_link_scope() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,auth AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM incidents WHERE id=NEW.incident_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'TENANT_MISMATCH_INCIDENT_COMMAND_LINK'; END IF;
 IF NOT public.fiberos_reality_entity_tenant_ok(NEW.entity_type,NEW.entity_id,NEW.tenant_id) THEN RAISE EXCEPTION 'TENANT_MISMATCH_INCIDENT_COMMAND_ENTITY'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.fiberos_guard_incident_command_link_scope() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_incident_command_link_scope ON incident_command_links;
CREATE TRIGGER trg_incident_command_link_scope BEFORE INSERT OR UPDATE OF incident_id,entity_type,entity_id,tenant_id ON incident_command_links FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_incident_command_link_scope();
DROP TRIGGER IF EXISTS trg_incident_command_links_no_delete ON incident_command_links;
CREATE TRIGGER trg_incident_command_links_no_delete BEFORE DELETE ON incident_command_links FOR EACH ROW EXECUTE FUNCTION public.fiberos_reality_append_only_guard();

CREATE TABLE IF NOT EXISTS incident_impact_snapshots(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE RESTRICT,
 captured_at timestamptz NOT NULL DEFAULT now(),tickets_count integer,services_count integer,customers_count integer,orders_count integer,work_packages_count integer,
 measurements_count integer,reconciliations_count integer,evidence_count integer,open_sla_breach_count integer,
 confidence text NOT NULL CHECK(confidence IN('observed','derived','unknown')),coverage_scope text NOT NULL DEFAULT 'EXPLICIT_LINKS_ONLY',unknown_fields text[] NOT NULL DEFAULT '{}',
 facts jsonb NOT NULL DEFAULT '{}'::jsonb,snapshot_hash char(64) NOT NULL CHECK(snapshot_hash~'^[0-9a-fA-F]{64}$'),created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE incident_impact_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_impact_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY incident_impact_snapshots_select ON incident_impact_snapshots FOR SELECT TO authenticated USING(tenant_id=fiberos_current_tenant_id());
CREATE POLICY incident_impact_snapshots_insert ON incident_impact_snapshots FOR INSERT TO authenticated WITH CHECK(tenant_id=fiberos_current_tenant_id());

CREATE OR REPLACE FUNCTION public.fiberos_guard_incident_snapshot_tenant() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,auth AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM incidents WHERE id=NEW.incident_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'TENANT_MISMATCH_INCIDENT_SNAPSHOT'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.fiberos_guard_incident_snapshot_tenant() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_incident_snapshot_tenant ON incident_impact_snapshots;
CREATE TRIGGER trg_incident_snapshot_tenant BEFORE INSERT OR UPDATE OF incident_id,tenant_id ON incident_impact_snapshots FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_incident_snapshot_tenant();
DROP TRIGGER IF EXISTS trg_incident_snapshot_no_delete ON incident_impact_snapshots;
CREATE TRIGGER trg_incident_snapshot_no_delete BEFORE DELETE ON incident_impact_snapshots FOR EACH ROW EXECUTE FUNCTION public.fiberos_reality_append_only_guard();

CREATE TABLE IF NOT EXISTS incident_command_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE RESTRICT,
 command_type text NOT NULL CHECK(command_type IN('link_entity','capture_impact','evidence_registered','evidence_linked','acquisition_selected','operator_note')),
 payload jsonb NOT NULL DEFAULT '{}'::jsonb,actor_id uuid,occurred_at timestamptz NOT NULL DEFAULT now(),idempotency_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,idempotency_key)
);
ALTER TABLE incident_command_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_command_events FORCE ROW LEVEL SECURITY;
CREATE POLICY incident_command_events_select ON incident_command_events FOR SELECT TO authenticated USING(tenant_id=fiberos_current_tenant_id());
CREATE POLICY incident_command_events_insert ON incident_command_events FOR INSERT TO authenticated WITH CHECK(tenant_id=fiberos_current_tenant_id());
CREATE OR REPLACE FUNCTION public.fiberos_guard_incident_command_event_scope() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,auth AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM incidents WHERE id=NEW.incident_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'TENANT_MISMATCH_INCIDENT_COMMAND_EVENT'; END IF;
 IF NEW.actor_id IS NOT NULL AND NEW.actor_id<>auth.uid() THEN RAISE EXCEPTION 'INCIDENT_COMMAND_ACTOR_MISMATCH'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.fiberos_guard_incident_command_event_scope() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_incident_command_event_scope ON incident_command_events;
CREATE TRIGGER trg_incident_command_event_scope BEFORE INSERT OR UPDATE OF incident_id,tenant_id,actor_id ON incident_command_events FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_incident_command_event_scope();
DROP TRIGGER IF EXISTS trg_incident_command_events_append_only ON incident_command_events;
CREATE TRIGGER trg_incident_command_events_append_only BEFORE DELETE OR UPDATE ON incident_command_events FOR EACH ROW EXECUTE FUNCTION public.fiberos_reality_append_only_guard();

COMMIT;
