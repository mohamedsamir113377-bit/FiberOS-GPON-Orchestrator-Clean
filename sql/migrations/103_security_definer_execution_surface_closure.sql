-- FiberOS R14.1 — close legacy SECURITY DEFINER / trigger EXECUTE exposure.
-- Root-cause fix: earlier migrations left several internal database authority
-- functions executable by the broad Supabase-style "authenticated" role.
-- The shipped API establishes the trusted fiberos_app role before invoking
-- application authority functions. Trigger-only functions do not need client
-- EXECUTE privileges at all.
--
-- This migration is additive so already-applied migrations remain immutable.
-- It closes only the proven internal execution surface; user-facing locale
-- read functionality is intentionally unchanged.

BEGIN;

-- Application-authority RPC: API only.
REVOKE ALL
  ON FUNCTION fiberos_transition_ticket(uuid,text)
  FROM PUBLIC, anon, authenticated, fiberos_app;
GRANT EXECUTE
  ON FUNCTION fiberos_transition_ticket(uuid,text)
  TO fiberos_app;

-- Append-only audit authority: API only.
REVOKE ALL
  ON FUNCTION fiberos_audit_append(uuid,uuid,text,text,text,uuid,char(64))
  FROM PUBLIC, anon, authenticated, fiberos_app;
GRANT EXECUTE
  ON FUNCTION fiberos_audit_append(uuid,uuid,text,text,text,uuid,char(64))
  TO fiberos_app;

-- Trigger-only authorities: no direct application/client EXECUTE path.
REVOKE ALL
  ON FUNCTION fiberos_guard_ticket_tenant_scope()
  FROM PUBLIC, anon, authenticated, fiberos_app;

REVOKE ALL
  ON FUNCTION fiberos_guard_ticket_status_change()
  FROM PUBLIC, anon, authenticated, fiberos_app;

REVOKE ALL
  ON FUNCTION fiberos_guard_incident_transition()
  FROM PUBLIC, anon, authenticated, fiberos_app;

REVOKE ALL
  ON FUNCTION fiberos_guard_incident_event_authority()
  FROM PUBLIC, anon, authenticated, fiberos_app;

REVOKE ALL
  ON FUNCTION fiberos_enforce_operational_tenant_consistency()
  FROM PUBLIC, anon, authenticated, fiberos_app;

REVOKE ALL
  ON FUNCTION fiberos_enforce_evidence_tenant_consistency()
  FROM PUBLIC, anon, authenticated, fiberos_app;

REVOKE ALL
  ON FUNCTION fiberos_enforce_field_close_idempotency_tenant_consistency()
  FROM PUBLIC, anon, authenticated, fiberos_app;

COMMIT;
