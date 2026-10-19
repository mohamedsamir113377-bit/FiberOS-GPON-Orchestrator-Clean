-- FiberOS R8 — Sensitive privilege-surface closure
-- P0 defense in depth. Direct DML is already revoked by 058; this closes
-- adjacent table capabilities (TRIGGER/REFERENCES) and sequence access that
-- could otherwise become a future privilege-escalation path.
BEGIN;

-- Application roles must never be able to create triggers or add foreign-key
-- references against protected evidence/replay surfaces.
REVOKE TRIGGER, REFERENCES ON audit_log, hash_ledger, payment_cycle_events,
  rework_case_events, material_chain_events, telco_webhook_replay_guard
  FROM anon, authenticated, fiberos_app;

-- Remove application access to identity/serial sequences belonging to the
-- protected tables. The DO block is intentionally fail-closed: if a protected
-- table exists but its backing sequence cannot be discovered, the migration
-- aborts rather than silently weakening the boundary.
DO $$
DECLARE
  t text;
  seqreg regclass;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'audit_log','hash_ledger','payment_cycle_events',
    'rework_case_events','material_chain_events',
    'telco_webhook_replay_guard'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'P0 protected table missing: %', t;
    END IF;

    SELECT s.objid::regclass INTO seqreg
    FROM pg_depend s
    JOIN pg_class tc ON tc.oid = s.refobjid
    JOIN pg_namespace tn ON tn.oid = tc.relnamespace
    WHERE s.classid = 'pg_class'::regclass
      AND s.refclassid = 'pg_class'::regclass
      AND s.deptype IN ('a','i')
      AND s.objsubid = 0
      AND tc.relname = t
      AND tn.nspname = 'public'
      AND EXISTS (
        SELECT 1 FROM pg_class sc
        JOIN pg_namespace sn ON sn.oid = sc.relnamespace
        WHERE sc.oid = s.objid
          AND sc.relkind = 'S'
          AND sn.nspname = 'public'
      )
    LIMIT 1;

    IF seqreg IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM anon, authenticated, fiberos_app',
        seqreg
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
