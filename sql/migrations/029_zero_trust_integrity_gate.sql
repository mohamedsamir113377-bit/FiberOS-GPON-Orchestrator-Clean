-- Alpha47 Zero-Trust Hardening Wave #2.
-- Database-enforced audit integrity + explicit concurrency primitives.
-- No synthetic audit events are generated; callers must use the append function.
BEGIN;

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS correlation_id uuid;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS request_hash char(64);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON audit_log(tenant_id, "timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_audit_correlation ON audit_log(correlation_id);

-- Existing rows are historical and cannot be safely assigned to a tenant here.
-- New authoritative audit writes require an explicit tenant context.
CREATE OR REPLACE FUNCTION fiberos_audit_append(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_action text,
  p_ref_id text,
  p_detail text,
  p_correlation_id uuid,
  p_request_hash char(64)
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
set search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_prev text;
  v_hash text;
  v_id bigint;
BEGIN
  IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'AUDIT_TENANT_REQUIRED'; END IF;
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUDIT_AUTH_REQUIRED'; END IF;
  IF p_actor_id IS NOT NULL AND p_actor_id <> auth.uid() THEN
    RAISE EXCEPTION 'AUDIT_ACTOR_MISMATCH';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM user_preferences up
    WHERE up.user_id=auth.uid() AND up.tenant_id=p_tenant_id
  ) THEN RAISE EXCEPTION 'AUDIT_TENANT_FORBIDDEN'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('fiberos:audit:'||p_tenant_id::text, 0));
  SELECT event_hash_chain INTO v_prev
  FROM audit_log
  WHERE tenant_id=p_tenant_id
  ORDER BY id DESC LIMIT 1;

  v_hash := encode(digest(
    coalesce(v_prev,'') || '|' || p_tenant_id::text || '|' || coalesce(p_actor_id::text,'') || '|' ||
    p_action || '|' || coalesce(p_ref_id,'') || '|' || coalesce(p_detail,'') || '|' ||
    coalesce(p_correlation_id::text,'') || '|' || coalesce(p_request_hash,'') || '|' || clock_timestamp()::text,
    'sha256'), 'hex');

  INSERT INTO audit_log(tenant_id, actor_id, action, ref_id, detail, prev_hash, event_hash_chain, correlation_id, request_hash)
  VALUES(p_tenant_id, coalesce(p_actor_id,auth.uid()), p_action, p_ref_id, p_detail, v_prev, v_hash, p_correlation_id, p_request_hash)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION fiberos_audit_append(uuid,uuid,text,text,text,uuid,char(64)) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fiberos_audit_append(uuid,uuid,text,text,text,uuid,char(64)) TO authenticated;

-- Direct authenticated INSERT is removed: authoritative audit writes go through
-- the security-definer append function above. Existing historical rows remain readable
-- according to the legacy management policy.
REVOKE INSERT ON audit_log FROM anon, authenticated;

DROP POLICY IF EXISTS audit_select_management ON audit_log;
CREATE POLICY audit_select_management ON audit_log
FOR SELECT TO authenticated USING (
  tenant_id IS NOT NULL
  AND tenant_id = fiberos_current_tenant_id()
  AND fiberos_has_any_role(ARRAY['qc','ops_manager','area_supervisor','exec','sysadmin'])
);

-- Prevent mutation even if a future grant accidentally exposes table DML.
DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_log;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
DROP TRIGGER IF EXISTS trg_audit_no_delete ON audit_log;
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

COMMIT;
