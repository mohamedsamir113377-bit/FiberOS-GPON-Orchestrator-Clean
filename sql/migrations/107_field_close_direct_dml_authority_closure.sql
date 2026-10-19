-- 107_field_close_direct_dml_authority_closure.sql
-- FiberOS R14.1 — close the remaining direct authenticated-client mutation
-- surface around the field-close integrity chain.
--
-- Root cause: the legacy Supabase-style grant in migration 015 gives the broad
-- authenticated role table DML. Earlier hardening closed direct writes for
-- append-only audit/ledger surfaces, but ticket/evidence/measurement/outbox
-- tables still retained client-side mutation capabilities.
--
-- The shipped API establishes the trusted fiberos_app role before database
-- writes. These revocations therefore remove only the broad client mutation
-- path; the trusted API and worker roles remain unchanged.
BEGIN;

-- Ticket lifecycle and close fields must not be mutated directly by clients.
-- Status is separately protected by the DB lifecycle trigger/function.
REVOKE UPDATE, DELETE, TRUNCATE
  ON tickets
  FROM PUBLIC, anon, authenticated;

-- Field-close evidence chain: all mutations must originate from the trusted
-- server-side application path, not a user-facing authenticated SQL client.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON evidence, optical_measurements, outbox_events, field_close_idempotency
  FROM PUBLIC, anon, authenticated;

-- Remove adjacent object privileges from the client roles as defense in depth.
REVOKE TRIGGER, REFERENCES
  ON tickets, evidence, optical_measurements, outbox_events, field_close_idempotency
  FROM PUBLIC, anon, authenticated;

-- The API enters the database as fiberos_app. Because fiberos_app inherits
-- authenticated, revoking the client role above also removes the inherited
-- DML privileges from the trusted API role. Restore only the exact mutation
-- capabilities required by fieldClose; never restore DELETE/TRUNCATE or broad
-- client privileges.
GRANT SELECT, UPDATE ON tickets TO fiberos_app;
GRANT SELECT, INSERT ON evidence TO fiberos_app;
GRANT SELECT, INSERT ON optical_measurements TO fiberos_app;
GRANT SELECT, INSERT ON outbox_events TO fiberos_app;
GRANT SELECT, INSERT ON field_close_idempotency TO fiberos_app;
GRANT USAGE, SELECT ON SEQUENCE optical_measurements_id_seq, outbox_events_id_seq TO fiberos_app;

-- Identity/serial sequence access is not needed by direct clients for these
-- mutation surfaces. Revoke it where a backing sequence exists.
DO $$
DECLARE
  table_name text;
  sequence_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'tickets',
    'evidence',
    'optical_measurements',
    'outbox_events',
    'field_close_idempotency'
  ] LOOP
    -- Not every table in this closure list has an `id` column.
    -- field_close_idempotency uses the composite key
    -- (tenant_id, ticket_id, idempotency_key). Guard the catalog lookup so
    -- pg_get_serial_sequence() is never asked for a nonexistent column.
    IF EXISTS (
      SELECT 1
      FROM pg_attribute a
      WHERE a.attrelid = format('public.%I', table_name)::regclass
        AND a.attname = 'id'
        AND NOT a.attisdropped
    ) THEN
      SELECT pg_get_serial_sequence(format('public.%I', table_name), 'id')
        INTO sequence_name;
    ELSE
      sequence_name := NULL;
    END IF;

    IF sequence_name IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM PUBLIC, anon, authenticated',
        sequence_name
      );
    END IF;
  END LOOP;
END
$$;

COMMENT ON TABLE tickets IS
  'Ticket mutations are API-authoritative; direct authenticated UPDATE/DELETE is prohibited.';

COMMENT ON TABLE evidence IS
  'Evidence mutations are API-authoritative; direct authenticated DML is prohibited.';

COMMENT ON TABLE optical_measurements IS
  'Optical measurement mutations are API-authoritative; direct authenticated DML is prohibited.';

COMMENT ON TABLE outbox_events IS
  'Outbox mutations are server-authoritative; direct authenticated DML is prohibited.';

COMMENT ON TABLE field_close_idempotency IS
  'Field-close idempotency mutations are server-authoritative; direct authenticated DML is prohibited.';

COMMIT;
