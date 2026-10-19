-- FiberOS R8 — Pre-DB Security Contract Hardening
-- This migration closes controls that are provable before a live database exists.
-- It deliberately does NOT claim RLS/runtime/concurrency proof.
BEGIN;

-- PostgreSQL 15+ no longer needs PUBLIC CREATE on the public schema. Keeping it
-- open creates an avoidable schema-shadowing/trust boundary for untrusted roles.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Future functions must not silently inherit PUBLIC EXECUTE. Existing functions
-- are governed by their explicit grants/revokes; this changes only future
-- defaults and therefore cannot silently revoke an application dependency.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Webhook replay storage is never an application write surface. FORCE RLS makes
-- the protection apply even when a future policy is accidentally broadened.
ALTER TABLE IF EXISTS telco_webhook_replay_guard ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS telco_webhook_replay_guard FORCE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON telco_webhook_replay_guard FROM anon, authenticated;

-- Provider secrets are a boundary concern: the current plaintext column is
-- retained for compatibility in this migration chain, but is explicitly marked
-- as requiring external secret-management before production admission.
COMMENT ON COLUMN telco_webhook_providers.signing_secret IS
  'TEMPORARY COMPATIBILITY BOUNDARY: production admission requires KMS/HSM-backed secret reference; plaintext secret storage is not production-certified.';

COMMIT;
