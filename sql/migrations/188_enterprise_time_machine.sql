-- Migration 188 (assumes 187 is latest; adjust). Append-only, hash-chained change log + as-of reconstruction.
-- ASSUMPTION to verify against your RLS convention: tenant id is text in setting 'app.tenant_id'.
BEGIN;

CREATE TABLE IF NOT EXISTS enterprise_change_log (
  seq         bigserial PRIMARY KEY,
  tenant_id   text        NOT NULL,
  table_name  text        NOT NULL,
  row_pk      text        NOT NULL,
  op          text        NOT NULL CHECK (op IN ('INSERT','UPDATE','DELETE')),
  old_data    jsonb,
  new_data    jsonb,
  actor       text        NOT NULL DEFAULT current_user,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  prev_hash   text,
  row_hash    text        NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ecl_asof_idx ON enterprise_change_log (tenant_id, table_name, row_pk, changed_at DESC);

ALTER TABLE enterprise_change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_change_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ecl_tenant ON enterprise_change_log;
CREATE POLICY ecl_tenant ON enterprise_change_log
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE OR REPLACE FUNCTION ecl_block_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN RAISE EXCEPTION 'enterprise_change_log is append-only'; END $$;
DROP TRIGGER IF EXISTS ecl_no_mutate ON enterprise_change_log;
CREATE TRIGGER ecl_no_mutate BEFORE UPDATE OR DELETE ON enterprise_change_log
  FOR EACH ROW EXECUTE FUNCTION ecl_block_mutation();
DROP TRIGGER IF EXISTS ecl_no_truncate ON enterprise_change_log;
CREATE TRIGGER ecl_no_truncate BEFORE TRUNCATE ON enterprise_change_log
  FOR EACH STATEMENT EXECUTE FUNCTION ecl_block_mutation();

-- Hash chain per tenant; advisory lock serialises writers so chains cannot fork.
CREATE OR REPLACE FUNCTION ecl_chain() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE p text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ecl:' || NEW.tenant_id));
  SELECT row_hash INTO p FROM enterprise_change_log WHERE tenant_id = NEW.tenant_id ORDER BY seq DESC LIMIT 1;
  NEW.prev_hash := p;
  NEW.row_hash := encode(sha256(convert_to(
    coalesce(p,'') || NEW.tenant_id || NEW.table_name || NEW.row_pk || NEW.op ||
    coalesce(NEW.old_data::text,'') || coalesce(NEW.new_data::text,'') || NEW.changed_at::text, 'UTF8')), 'hex');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ecl_chain_trg ON enterprise_change_log;
CREATE TRIGGER ecl_chain_trg BEFORE INSERT ON enterprise_change_log
  FOR EACH ROW EXECUTE FUNCTION ecl_chain();

-- Attach per table: CREATE TRIGGER t_ecl AFTER INSERT OR UPDATE OR DELETE ON <table>
--   FOR EACH ROW EXECUTE FUNCTION ecl_capture('id');   -- arg = pk column
CREATE OR REPLACE FUNCTION ecl_capture() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE pk text := TG_ARGV[0]; o jsonb; n jsonb; t text;
BEGIN
  o := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END;
  n := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END;
  t := coalesce(n->>'tenant_id', o->>'tenant_id');
  IF t IS NULL THEN RAISE EXCEPTION 'ecl_capture: row has no tenant_id'; END IF;
  INSERT INTO enterprise_change_log(tenant_id, table_name, row_pk, op, old_data, new_data)
  VALUES (t, TG_TABLE_NAME, coalesce(n->>pk, o->>pk), TG_OP, o, n);
  RETURN NULL;
END $$;

-- Row state as of a timestamp (NULL if absent/deleted). Runs under caller's RLS.
CREATE OR REPLACE FUNCTION ecl_row_as_of(p_table text, p_pk text, p_ts timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN op = 'DELETE' THEN NULL ELSE new_data END
  FROM enterprise_change_log
  WHERE table_name = p_table AND row_pk = p_pk AND changed_at <= p_ts
  ORDER BY seq DESC LIMIT 1
$$;

-- Returns first broken seq for the current tenant, or NULL if the chain is intact.
CREATE OR REPLACE FUNCTION ecl_verify_chain() RETURNS bigint
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE r record; prev text := NULL; calc text;
BEGIN
  FOR r IN SELECT * FROM enterprise_change_log ORDER BY seq LOOP
    calc := encode(sha256(convert_to(coalesce(prev,'') || r.tenant_id || r.table_name || r.row_pk || r.op ||
      coalesce(r.old_data::text,'') || coalesce(r.new_data::text,'') || r.changed_at::text, 'UTF8')), 'hex');
    IF r.prev_hash IS DISTINCT FROM prev OR r.row_hash <> calc THEN RETURN r.seq; END IF;
    prev := r.row_hash;
  END LOOP;
  RETURN NULL;
END $$;

COMMIT;
