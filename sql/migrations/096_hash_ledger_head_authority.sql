-- 096_hash_ledger_head_authority.sql
-- FiberOS R14.1 — move hash-ledger head reads behind the DB authority boundary.
--
-- The application must not read hash_ledger directly because its RLS read
-- policy is intentionally restricted. This function acquires the same
-- transaction advisory lock used by the append authority and returns the
-- current head while keeping the constrained app role out of the table.

BEGIN;

CREATE OR REPLACE FUNCTION fiberos_hash_ledger_head()
RETURNS char(64)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_head char(64);
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'LEDGER_CALLER_IDENTITY_REJECTED';
  END IF;

  v_role := auth.jwt()->>'role';
  IF v_role <> 'authenticated' THEN
    RAISE EXCEPTION 'LEDGER_CALLER_ROLE_REJECTED';
  END IF;

  PERFORM pg_advisory_xact_lock(86204401);

  SELECT block_hash
    INTO v_head
    FROM hash_ledger
   ORDER BY block_index DESC
   LIMIT 1;

  RETURN coalesce(v_head, repeat('0',64)::char(64));
END
$$;

REVOKE ALL ON FUNCTION fiberos_hash_ledger_head() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fiberos_hash_ledger_head() TO authenticated, fiberos_app;

COMMIT;
