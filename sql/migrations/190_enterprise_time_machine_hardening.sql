-- Migration 190: Enterprise Time Machine hardening.
--
-- Reproduces and fixes two defects proven on PostgreSQL against migration 188:
--   D1  ecl_verify_chain() carried ONE global `prev` across every tenant, while
--       ecl_chain() chains per tenant. As soon as two tenants interleave in seq
--       order the verifier reports a break that does not exist.
--   D2  `actor` was not part of the hashed payload, so a writer could rewrite the
--       actor column without breaking the chain.
-- It also wires ecl_capture() onto the declared core operational tables.
--
-- Rows written from now on are hash_version 2 (actor-bound). Pre-existing rows keep
-- hash_version 1 and are verified with the legacy payload, so no history is invalidated.
BEGIN;

ALTER TABLE enterprise_change_log
  ADD COLUMN IF NOT EXISTS hash_version smallint NOT NULL DEFAULT 1;

COMMENT ON COLUMN enterprise_change_log.hash_version IS
  'Hash-format version: 1 = legacy (no actor), 2 = actor-bound. New rows are always written as 2.';

-- D2: bind actor into the hash and tag the format version.
CREATE OR REPLACE FUNCTION ecl_chain() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE p text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ecl:' || NEW.tenant_id));
  SELECT row_hash INTO p FROM enterprise_change_log
   WHERE tenant_id = NEW.tenant_id ORDER BY seq DESC LIMIT 1;
  NEW.prev_hash := p;
  NEW.hash_version := 2;
  NEW.row_hash := encode(sha256(convert_to(
    coalesce(p,'') || NEW.tenant_id || NEW.table_name || NEW.row_pk || NEW.op ||
    coalesce(NEW.old_data::text,'') || coalesce(NEW.new_data::text,'') ||
    coalesce(NEW.actor,'') || NEW.changed_at::text, 'UTF8')), 'hex');
  RETURN NEW;
END $$;

-- D1 + D2: chain state restarts per tenant and the actor is verified.
CREATE OR REPLACE FUNCTION ecl_verify_chain() RETURNS bigint
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE r record; chain text; cur text := NULL; calc text;
BEGIN
  FOR r IN SELECT * FROM enterprise_change_log ORDER BY tenant_id, seq LOOP
    IF r.tenant_id IS DISTINCT FROM cur THEN
      cur := r.tenant_id;
      chain := NULL;   -- D1 fix: per-tenant chain, never a global prev
    END IF;
    IF r.hash_version >= 2 THEN
      calc := encode(sha256(convert_to(
        coalesce(chain,'') || r.tenant_id || r.table_name || r.row_pk || r.op ||
        coalesce(r.old_data::text,'') || coalesce(r.new_data::text,'') ||
        coalesce(r.actor,'') || r.changed_at::text, 'UTF8')), 'hex');
    ELSE
      calc := encode(sha256(convert_to(
        coalesce(chain,'') || r.tenant_id || r.table_name || r.row_pk || r.op ||
        coalesce(r.old_data::text,'') || coalesce(r.new_data::text,'') ||
        r.changed_at::text, 'UTF8')), 'hex');
    END IF;
    IF r.prev_hash IS DISTINCT FROM chain OR r.row_hash <> calc THEN
      RETURN r.seq;
    END IF;
    chain := r.row_hash;
  END LOOP;
  RETURN NULL;
END $$;

-- Idempotent attachment of the capture trigger onto one operational table.
CREATE OR REPLACE FUNCTION ecl_attach_capture(p_table text, p_pk text DEFAULT 'id')
RETURNS boolean
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE trg text;
BEGIN
  IF to_regclass('public.' || p_table) IS NULL THEN
    RAISE NOTICE 'ecl_attach_capture: skipped % (table absent)', p_table;
    RETURN false;
  END IF;
  trg := 't_ecl_' || p_table;
  EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trg, p_table);
  EXECUTE format(
    'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION ecl_capture(%L)',
    trg, p_table, p_pk);
  RETURN true;
END $$;

-- Core operational tables this migration wires capture onto.
-- Must stay byte-identical to config/ecl-capture-tables.v1.json (asserted by test).
-- ecl-capture-core:begin
SELECT ecl_attach_capture('contractor_entities', 'id');
SELECT ecl_attach_capture('contractor_qualifications', 'id');
SELECT ecl_attach_capture('contractor_work_authorizations', 'id');
SELECT ecl_attach_capture('contractor_work_measurements', 'id');
SELECT ecl_attach_capture('contractor_work_package_events', 'id');
SELECT ecl_attach_capture('customer_accounts', 'id');
SELECT ecl_attach_capture('enterprise_dashboard_contracts', 'id');
SELECT ecl_attach_capture('event_outbox_contract', 'id');
SELECT ecl_attach_capture('fiberos_asset_dna', 'id');
SELECT ecl_attach_capture('ftth_customer_orders', 'id');
-- ecl-capture-core:end

COMMIT;
