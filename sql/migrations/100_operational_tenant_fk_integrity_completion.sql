-- 100_operational_tenant_fk_integrity_completion.sql
-- Close the adversarially proven tenant-boundary gap for evidence -> tickets.
-- This is additive: migration 099 remains immutable.
BEGIN;

CREATE OR REPLACE FUNCTION fiberos_enforce_evidence_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, auth
AS $$
BEGIN
  IF NEW.ticket_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM tickets t
    WHERE t.id = NEW.ticket_id
      AND t.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'TENANT_MISMATCH_EVIDENCE_TICKET'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION fiberos_enforce_evidence_tenant_consistency() OWNER TO fiberos_owner;

DROP TRIGGER IF EXISTS trg_evidence_tenant_consistency ON evidence;
CREATE TRIGGER trg_evidence_tenant_consistency
BEFORE INSERT OR UPDATE OF ticket_id, tenant_id ON evidence
FOR EACH ROW
EXECUTE FUNCTION fiberos_enforce_evidence_tenant_consistency();

REVOKE ALL ON FUNCTION fiberos_enforce_evidence_tenant_consistency() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fiberos_enforce_evidence_tenant_consistency() TO authenticated;

COMMIT;
