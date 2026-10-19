-- 099_operational_tenant_fk_integrity.sql
-- Enforce tenant consistency across operational foreign-key relationships.
-- RLS protects row visibility; these triggers additionally prevent valid IDs
-- from another tenant being attached to a row in the caller's tenant.
BEGIN;

CREATE OR REPLACE FUNCTION fiberos_enforce_operational_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, auth
AS $$
BEGIN
  IF TG_TABLE_NAME = 'tickets' THEN
    IF NEW.service_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM services s
      WHERE s.id = NEW.service_id
        AND s.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'TENANT_MISMATCH_TICKET_SERVICE'
        USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'call_sessions' THEN
    IF NEW.service_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM services s
      WHERE s.id = NEW.service_id
        AND s.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'TENANT_MISMATCH_CALL_SERVICE'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.ticket_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM tickets t
      WHERE t.id = NEW.ticket_id
        AND t.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'TENANT_MISMATCH_CALL_TICKET'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.assigned_agent_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM technicians t
      WHERE t.id = NEW.assigned_agent_id
        AND t.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'TENANT_MISMATCH_CALL_AGENT'
        USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'call_events' THEN
    IF NOT EXISTS (
      SELECT 1 FROM call_sessions s
      WHERE s.id = NEW.call_session_id
        AND s.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'TENANT_MISMATCH_CALL_EVENT_SESSION'
        USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'incidents' THEN
    IF NEW.primary_asset_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM network_assets a
      WHERE a.id = NEW.primary_asset_id
        AND a.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'TENANT_MISMATCH_INCIDENT_ASSET'
        USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'incident_events' THEN
    IF NOT EXISTS (
      SELECT 1 FROM incidents i
      WHERE i.id = NEW.incident_id
        AND i.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'TENANT_MISMATCH_INCIDENT_EVENT_INCIDENT'
        USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'dispatch_requests' THEN
    IF NEW.ticket_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM tickets t
      WHERE t.id = NEW.ticket_id
        AND t.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'TENANT_MISMATCH_DISPATCH_TICKET'
        USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'call_queue_assignments' THEN
    IF NOT EXISTS (
      SELECT 1 FROM call_sessions s
      WHERE s.id = NEW.call_session_id
        AND s.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'TENANT_MISMATCH_QUEUE_SESSION'
        USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM technicians t
      WHERE t.id = NEW.agent_id
        AND t.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'TENANT_MISMATCH_QUEUE_AGENT'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION fiberos_enforce_operational_tenant_consistency() OWNER TO fiberos_owner;

DROP TRIGGER IF EXISTS trg_ticket_operational_tenant_consistency ON tickets;
CREATE TRIGGER trg_ticket_operational_tenant_consistency
BEFORE INSERT OR UPDATE OF service_id, tenant_id ON tickets
FOR EACH ROW
EXECUTE FUNCTION fiberos_enforce_operational_tenant_consistency();

DROP TRIGGER IF EXISTS trg_call_session_operational_tenant_consistency ON call_sessions;
CREATE TRIGGER trg_call_session_operational_tenant_consistency
BEFORE INSERT OR UPDATE OF service_id, ticket_id, assigned_agent_id, tenant_id ON call_sessions
FOR EACH ROW
EXECUTE FUNCTION fiberos_enforce_operational_tenant_consistency();

DROP TRIGGER IF EXISTS trg_call_event_operational_tenant_consistency ON call_events;
CREATE TRIGGER trg_call_event_operational_tenant_consistency
BEFORE INSERT OR UPDATE OF call_session_id, tenant_id ON call_events
FOR EACH ROW
EXECUTE FUNCTION fiberos_enforce_operational_tenant_consistency();

DROP TRIGGER IF EXISTS trg_incident_operational_tenant_consistency ON incidents;
CREATE TRIGGER trg_incident_operational_tenant_consistency
BEFORE INSERT OR UPDATE OF primary_asset_id, tenant_id ON incidents
FOR EACH ROW
EXECUTE FUNCTION fiberos_enforce_operational_tenant_consistency();

DROP TRIGGER IF EXISTS trg_incident_event_operational_tenant_consistency ON incident_events;
CREATE TRIGGER trg_incident_event_operational_tenant_consistency
BEFORE INSERT OR UPDATE OF incident_id, tenant_id ON incident_events
FOR EACH ROW
EXECUTE FUNCTION fiberos_enforce_operational_tenant_consistency();

DROP TRIGGER IF EXISTS trg_dispatch_operational_tenant_consistency ON dispatch_requests;
CREATE TRIGGER trg_dispatch_operational_tenant_consistency
BEFORE INSERT OR UPDATE OF ticket_id, tenant_id ON dispatch_requests
FOR EACH ROW
EXECUTE FUNCTION fiberos_enforce_operational_tenant_consistency();

DROP TRIGGER IF EXISTS trg_queue_assignment_operational_tenant_consistency ON call_queue_assignments;
CREATE TRIGGER trg_queue_assignment_operational_tenant_consistency
BEFORE INSERT OR UPDATE OF call_session_id, agent_id, tenant_id ON call_queue_assignments
FOR EACH ROW
EXECUTE FUNCTION fiberos_enforce_operational_tenant_consistency();

REVOKE ALL ON FUNCTION fiberos_enforce_operational_tenant_consistency() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fiberos_enforce_operational_tenant_consistency() TO authenticated;

COMMIT;
