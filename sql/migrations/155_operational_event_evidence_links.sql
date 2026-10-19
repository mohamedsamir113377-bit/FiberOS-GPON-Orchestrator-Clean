-- 155_operational_event_evidence_links.sql
-- Bind canonical operational events to immutable Evidence Vault objects.
-- No broker delivery or runtime storage verification is claimed here.
BEGIN;

CREATE TABLE IF NOT EXISTS operational_event_evidence_links(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL REFERENCES outbox_events(event_id) ON DELETE RESTRICT,
  evidence_vault_id uuid NOT NULL REFERENCES evidence_vault_objects(id) ON DELETE RESTRICT,
  link_role text NOT NULL DEFAULT 'supporting'
    CHECK(link_role IN('primary','supporting','acceptance','qc','commercial','timeline')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,event_id,evidence_vault_id,link_role)
);

CREATE INDEX IF NOT EXISTS idx_operational_event_evidence_links_event
  ON operational_event_evidence_links(tenant_id,event_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operational_event_evidence_links_evidence
  ON operational_event_evidence_links(tenant_id,evidence_vault_id,created_at DESC);

ALTER TABLE operational_event_evidence_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_event_evidence_links FORCE ROW LEVEL SECURITY;

CREATE POLICY operational_event_evidence_links_select
  ON operational_event_evidence_links
  FOR SELECT TO authenticated
  USING(tenant_id=fiberos_current_tenant_id());

CREATE POLICY operational_event_evidence_links_insert
  ON operational_event_evidence_links
  FOR INSERT TO authenticated
  WITH CHECK(
    tenant_id=fiberos_current_tenant_id()
    AND fiberos_has_any_role(ARRAY['call_center','field_tech','technician','team_lead','qc','ops_manager','area_supervisor','dispatcher','exec','sysadmin'])
  );

CREATE OR REPLACE FUNCTION public.fiberos_guard_operational_event_evidence_link_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=pg_catalog,public,auth
AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM outbox_events e
    WHERE e.event_id=NEW.event_id AND e.tenant_id=NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'TENANT_MISMATCH_OPERATIONAL_EVENT';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM evidence_vault_objects v
    WHERE v.id=NEW.evidence_vault_id AND v.tenant_id=NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'TENANT_MISMATCH_EVIDENCE_VAULT';
  END IF;

  IF NEW.created_by IS NOT NULL AND NEW.created_by<>auth.uid() THEN
    RAISE EXCEPTION 'OPERATIONAL_EVENT_EVIDENCE_ACTOR_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fiberos_guard_operational_event_evidence_link_scope() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_operational_event_evidence_link_scope
  ON operational_event_evidence_links;

CREATE TRIGGER trg_operational_event_evidence_link_scope
  BEFORE INSERT OR UPDATE OF tenant_id,event_id,evidence_vault_id,created_by
  ON operational_event_evidence_links
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_operational_event_evidence_link_scope();

CREATE OR REPLACE FUNCTION public.fiberos_guard_operational_event_evidence_link_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
BEGIN
  RAISE EXCEPTION 'OPERATIONAL_EVENT_EVIDENCE_LINK_APPEND_ONLY';
END;
$$;

REVOKE ALL ON FUNCTION public.fiberos_guard_operational_event_evidence_link_append_only() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_operational_event_evidence_link_append_only
  ON operational_event_evidence_links;

CREATE TRIGGER trg_operational_event_evidence_link_append_only
  BEFORE UPDATE OR DELETE
  ON operational_event_evidence_links
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_operational_event_evidence_link_append_only();

COMMIT;
