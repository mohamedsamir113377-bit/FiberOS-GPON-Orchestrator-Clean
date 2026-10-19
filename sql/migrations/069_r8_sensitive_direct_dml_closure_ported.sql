-- FiberOS R8 — Sensitive direct-DML closure
-- P0 pre-admission hardening. This migration intentionally fails if a protected
-- relation is absent: silent no-op is not acceptable for a security boundary.
BEGIN;

-- Append-only / evidence authorities: clients must use the authoritative
-- server-side functions/triggers rather than direct table mutation.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_log FROM anon, authenticated, fiberos_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON hash_ledger FROM anon, authenticated, fiberos_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON payment_cycle_events FROM anon, authenticated, fiberos_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON rework_case_events FROM anon, authenticated, fiberos_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON material_chain_events FROM anon, authenticated, fiberos_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON telco_webhook_replay_guard FROM anon, authenticated, fiberos_app;

-- Defense in depth: explicitly prevent these roles from granting the revoked
-- privileges back through object-level ACLs.
REVOKE ALL PRIVILEGES ON audit_log, hash_ledger, payment_cycle_events,
  rework_case_events, material_chain_events, telco_webhook_replay_guard
  FROM anon, authenticated, fiberos_app;

-- Restore read-only access where operational evidence is intentionally visible
-- through RLS. RLS remains the row-level authority; these grants are not a
-- substitute for policy enforcement.
GRANT SELECT ON audit_log, hash_ledger, payment_cycle_events,
  rework_case_events, material_chain_events TO authenticated;

COMMENT ON TABLE audit_log IS 'P0 protected append-only evidence surface; direct client DML prohibited.';
COMMENT ON TABLE hash_ledger IS 'P0 protected append-only integrity ledger; direct client DML prohibited.';
COMMENT ON TABLE payment_cycle_events IS 'P0 protected append-only commercial evidence; direct client DML prohibited.';
COMMENT ON TABLE rework_case_events IS 'P0 protected append-only rework evidence; direct client DML prohibited.';
COMMENT ON TABLE material_chain_events IS 'P0 protected append-only material custody evidence; direct client DML prohibited.';
COMMENT ON TABLE telco_webhook_replay_guard IS 'P0 protected replay authority; direct client DML prohibited.';

COMMIT;
