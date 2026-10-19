-- Append-only hash ledger (HMAC-SHA256 chain). Application computes hashes via packages/domain/src/ledger.js
CREATE TABLE IF NOT EXISTS hash_ledger (
  block_index   BIGSERIAL PRIMARY KEY,
  previous_hash CHAR(64) NOT NULL,
  block_hash    CHAR(64) NOT NULL UNIQUE,
  ts_epoch_ms   BIGINT NOT NULL,
  event_type    TEXT NOT NULL,
  actor_id      TEXT,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION reject_hash_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'hash_ledger is append-only: % not permitted', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_hash_ledger_no_update ON hash_ledger;
CREATE TRIGGER trg_hash_ledger_no_update
  BEFORE UPDATE OR DELETE ON hash_ledger
  FOR EACH ROW EXECUTE FUNCTION reject_hash_ledger_mutation();

COMMENT ON TABLE hash_ledger IS 'Tamper-evident event chain. LEDGER_SECRET_KEY required in app; no default secret.';
