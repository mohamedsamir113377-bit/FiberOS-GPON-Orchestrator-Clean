-- FiberOS R14.1 — defense-in-depth tenant scope for ticket writes.
-- RLS remains the primary database isolation boundary. This trigger adds a
-- second, independent check for application-role writes so a runtime ticket
-- can never carry a tenant_id outside the current authenticated tenant.

CREATE OR REPLACE FUNCTION fiberos_guard_ticket_tenant_scope() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  current_tenant uuid;
BEGIN
  IF current_user = 'fiberos_app' THEN
    current_tenant := fiberos_current_tenant_id();

    IF current_tenant IS NULL THEN
      RAISE EXCEPTION 'TENANT_CONTEXT_REQUIRED';
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.tenant_id IS DISTINCT FROM current_tenant THEN
      RAISE EXCEPTION 'TICKET_TENANT_SCOPE_VIOLATION';
    END IF;

    IF NEW.tenant_id IS DISTINCT FROM current_tenant THEN
      RAISE EXCEPTION 'TICKET_TENANT_SCOPE_VIOLATION';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_ticket_tenant_scope ON tickets;

CREATE TRIGGER trg_ticket_tenant_scope
BEFORE INSERT OR UPDATE ON tickets
FOR EACH ROW
EXECUTE FUNCTION fiberos_guard_ticket_tenant_scope();

COMMENT ON FUNCTION fiberos_guard_ticket_tenant_scope() IS
  'Defense-in-depth tenant scope guard for fiberos_app ticket INSERT/UPDATE writes.';
