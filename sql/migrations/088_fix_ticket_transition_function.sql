-- FiberOS R14.1 — correct DB-authoritative ticket transition function.
-- This is a corrective migration for the already-versioned lifecycle function.
-- It preserves row locking and compare-and-update semantics so concurrent
-- transitions cannot both succeed.

CREATE OR REPLACE FUNCTION fiberos_transition_ticket(p_ticket_id uuid, p_to text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,auth
AS $$
DECLARE
  v_tenant uuid;
  v_role text;
  v_from text;
  v_to text := replace(lower(trim(p_to)), '-', '_');
  v_allowed boolean := false;
BEGIN
  v_tenant := fiberos_current_tenant_id();
  v_role := auth.jwt()->'app_metadata'->>'role';

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'TENANT_CONTEXT_REQUIRED';
  END IF;

  IF v_role IS NULL OR v_role='' THEN
    RAISE EXCEPTION 'ROLE_REQUIRED_FOR_TRANSITION';
  END IF;

  IF p_ticket_id IS NULL OR v_to IS NULL OR v_to='' THEN
    RAISE EXCEPTION 'TRANSITION_INPUT_REQUIRED';
  END IF;

  SELECT status
    INTO v_from
    FROM tickets
   WHERE id=p_ticket_id
     AND tenant_id=v_tenant
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TICKET_NOT_FOUND';
  END IF;

  v_allowed := CASE
    WHEN v_from='pending' AND v_to='in_progress' AND v_role IN ('field_tech','dispatcher','ops_manager','sysadmin') THEN true
    WHEN v_from='in_progress' AND v_to='awaiting_evidence' AND v_role IN ('field_tech','ops_manager','sysadmin') THEN true
    WHEN v_from='awaiting_evidence' AND v_to='manager_review' AND v_role IN ('field_tech','qc','ops_manager','sysadmin') THEN true
    WHEN v_from='manager_review' AND v_to='completed' AND v_role IN ('ops_manager','qc','sysadmin','area_supervisor') THEN true
    WHEN v_from='manager_review' AND v_to='rejected' AND v_role IN ('ops_manager','qc','sysadmin') THEN true
    ELSE false
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'TRANSITION_REJECTED';
  END IF;

  UPDATE tickets
     SET status=v_to,
         updated_at=now(),
         first_assigned_at=CASE
           WHEN v_to='in_progress' AND first_assigned_at IS NULL THEN now()
           ELSE first_assigned_at
         END,
         closed_at=CASE
           WHEN v_to IN ('completed','cancelled','rejected','faulty') AND closed_at IS NULL THEN now()
           WHEN v_to NOT IN ('completed','cancelled','rejected','faulty') THEN NULL
           ELSE closed_at
         END
   WHERE id=p_ticket_id
     AND tenant_id=v_tenant
     AND status=v_from;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TICKET_NOT_UPDATED';
  END IF;

  RETURN jsonb_build_object(
    'ticket_id',p_ticket_id,
    'from',v_from,
    'to',v_to,
    'tenant_id',v_tenant,
    'role',v_role
  );
END
$$;

REVOKE ALL ON FUNCTION fiberos_transition_ticket(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fiberos_transition_ticket(uuid,text) TO authenticated;

COMMENT ON FUNCTION fiberos_transition_ticket(uuid,text) IS
  'DB-authoritative tenant-scoped ticket lifecycle transition with row locking and compare-and-update concurrency control.';
