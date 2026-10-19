-- 095_hash_ledger_authority_force_rls.sql
-- FiberOS R14.1 — make the hash-ledger authority compatible with FORCE RLS.
--
-- Migration 085 correctly forced RLS on hash_ledger, but the existing
-- SECURITY DEFINER append function was not a valid FORCE-RLS write path:
-- it checked current_user (the definer role) and the constrained app role
-- could not INSERT directly after migration 069.
--
-- This migration keeps direct table DML revoked and makes the SECURITY
-- DEFINER function the sole append path used by the application.

BEGIN;

ALTER TABLE hash_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE hash_ledger FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hash_ledger_owner_select ON hash_ledger;
CREATE POLICY hash_ledger_owner_select ON hash_ledger
FOR SELECT TO fiberos_owner
USING (true);

DROP POLICY IF EXISTS hash_ledger_owner_insert ON hash_ledger;
CREATE POLICY hash_ledger_owner_insert ON hash_ledger
FOR INSERT TO fiberos_owner
WITH CHECK (
  actor_id = auth.uid()::text
);

CREATE OR REPLACE FUNCTION fiberos_append_hash_ledger(
  p_previous_hash char(64),
  p_block_hash char(64),
  p_ts_epoch_ms bigint,
  p_event_type text,
  p_actor_id text,
  p_payload jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_last_hash char(64);
  v_next bigint;
  v_jwt_role text;
  v_actor text;
BEGIN
  IF p_previous_hash IS NULL OR p_block_hash IS NULL OR p_ts_epoch_ms IS NULL
     OR p_event_type IS NULL OR trim(p_event_type) = ''
     OR p_actor_id IS NULL OR trim(p_actor_id) = '' THEN
    RAISE EXCEPTION 'LEDGER_INPUT_REQUIRED';
  END IF;

  v_actor := auth.uid()::text;
  v_jwt_role := auth.jwt()->>'role';
  IF v_actor IS NULL OR v_jwt_role <> 'authenticated' OR p_actor_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'LEDGER_CALLER_IDENTITY_REJECTED';
  END IF;

  PERFORM pg_advisory_xact_lock(86204401);

  SELECT block_hash
    INTO v_last_hash
    FROM hash_ledger
   ORDER BY block_index DESC
   LIMIT 1;

  IF v_last_hash IS NULL THEN
    IF p_previous_hash <> repeat('0',64)::char(64) THEN
      RAISE EXCEPTION 'LEDGER_GENESIS_PREVIOUS_HASH_MISMATCH';
    END IF;
  ELSIF p_previous_hash <> v_last_hash THEN
    RAISE EXCEPTION 'LEDGER_HEAD_CHANGED_RETRY';
  END IF;

  INSERT INTO hash_ledger(previous_hash,block_hash,ts_epoch_ms,event_type,actor_id,payload)
  VALUES(p_previous_hash,p_block_hash,p_ts_epoch_ms,p_event_type,p_actor_id,coalesce(p_payload,'{}'::jsonb))
  RETURNING block_index INTO v_next;

  RETURN v_next;
END
$$;

REVOKE ALL ON FUNCTION fiberos_append_hash_ledger(char(64),char(64),bigint,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fiberos_append_hash_ledger(char(64),char(64),bigint,text,text,jsonb) TO authenticated, fiberos_app;

COMMIT;
