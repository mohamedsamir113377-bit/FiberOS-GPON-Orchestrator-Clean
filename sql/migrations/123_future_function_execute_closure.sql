-- 123_future_function_execute_closure.sql
-- Close the future-function EXECUTE default inherited from migration 015.
-- Existing function grants are intentionally unchanged; application authorities
-- must be granted explicitly by later migrations.
BEGIN;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM authenticated;

COMMIT;
