-- Alpha46 P0 ledger authority.
-- Prevent direct authenticated INSERTs and serialize all appends at the DB boundary.
BEGIN;

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
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_last_hash char(64);
  v_next bigint;
  v_role text;
BEGIN
  IF p_previous_hash IS NULL OR p_block_hash IS NULL OR p_ts_epoch_ms IS NULL
     OR p_event_type IS NULL OR p_event_type = '' THEN
    RAISE EXCEPTION 'LEDGER_INPUT_REQUIRED';
  END IF;

  v_role := current_user;
  IF v_role NOT IN ('authenticated','fiberos_app') THEN
    RAISE EXCEPTION 'LEDGER_CALLER_ROLE_REJECTED';
  END IF;

  -- Transaction-scoped advisory lock serializes the read/validate/append
  -- critical section. The key is intentionally fixed for this ledger.
  PERFORM pg_advisory_xact_lock(86204401);

  SELECT block_hash INTO v_last_hash
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

REVOKE INSERT, UPDATE, DELETE ON hash_ledger FROM anon, authenticated;
REVOKE ALL ON FUNCTION fiberos_append_hash_ledger(char(64),char(64),bigint,text,text,jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION fiberos_append_hash_ledger(char(64),char(64),bigint,text,text,jsonb) TO authenticated;

COMMENT ON FUNCTION fiberos_append_hash_ledger IS
  'Authoritative serialized ledger append. Direct client table mutation is revoked; append is transaction-locked and head-validated.';

COMMIT;
