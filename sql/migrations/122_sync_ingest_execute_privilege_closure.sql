-- 122_sync_ingest_execute_privilege_closure.sql
-- Security closure for the sync-ingest RPC authority surface identified in issue #10.
-- The HTTP route supplies a server-verified principal; the DB RPC itself must not
-- remain directly executable by PUBLIC/client/runtime/worker roles.
BEGIN;

REVOKE ALL ON FUNCTION public.fiberos_ingest_sync_batch(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, fiberos_runtime, fiberos_worker, fiberos_app;

GRANT EXECUTE ON FUNCTION public.fiberos_ingest_sync_batch(jsonb, jsonb)
  TO fiberos_app;

COMMENT ON FUNCTION public.fiberos_ingest_sync_batch(jsonb, jsonb) IS
  'Sync ingest authority is restricted to fiberos_app; the HTTP layer supplies the verified principal and the RPC is not a client-facing execute surface.';

COMMIT;
