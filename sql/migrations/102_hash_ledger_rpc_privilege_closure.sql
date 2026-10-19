-- FiberOS R14.1 — final privilege closure for hash-ledger RPC authorities.
-- Root-cause fix: migrations 095/096 correctly removed direct table DML but still
-- granted EXECUTE on their SECURITY DEFINER functions to the broad Supabase-style
-- authenticated role. That left a normal authenticated caller able to invoke the
-- ledger authorities directly and submit arbitrary ledger blocks as their own actor.
--
-- This corrective migration is intentionally additive and leaves 095/096 immutable.
-- The shipped API executes these functions only after SET LOCAL ROLE fiberos_app.
-- Revoke every inherited/direct grant from the broad role and grant the RPC boundary
-- only to fiberos_app, preserving the existing database-authoritative application path.

BEGIN;

REVOKE ALL
  ON FUNCTION fiberos_append_hash_ledger(char(64),char(64),bigint,text,text,jsonb)
  FROM PUBLIC, anon, authenticated, fiberos_app;

GRANT EXECUTE
  ON FUNCTION fiberos_append_hash_ledger(char(64),char(64),bigint,text,text,jsonb)
  TO fiberos_app;

REVOKE ALL
  ON FUNCTION fiberos_hash_ledger_head()
  FROM PUBLIC, anon, authenticated, fiberos_app;

GRANT EXECUTE
  ON FUNCTION fiberos_hash_ledger_head()
  TO fiberos_app;

COMMENT ON FUNCTION fiberos_append_hash_ledger(char(64),char(64),bigint,text,text,jsonb) IS
  'FiberOS hash-ledger append authority. EXECUTE restricted to fiberos_app; direct authenticated RPC invocation is prohibited.';

COMMENT ON FUNCTION fiberos_hash_ledger_head() IS
  'FiberOS hash-ledger head authority. EXECUTE restricted to fiberos_app; direct authenticated RPC invocation is prohibited.';

COMMIT;
