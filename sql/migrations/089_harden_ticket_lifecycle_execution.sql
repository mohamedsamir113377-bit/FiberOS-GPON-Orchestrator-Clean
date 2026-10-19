-- FiberOS R14.1 — harden DB-authoritative ticket lifecycle execution.
-- Keeps SECURITY DEFINER for the narrow lifecycle authority path, but makes
-- fiberos_owner subject to explicit tenant-scoped RLS policies and binds the
-- lifecycle trigger marker to the trusted definer role. A caller cannot bypass
-- the status trigger merely by setting the custom GUC.

-- SECURITY DEFINER runs as fiberos_owner. FORCE RLS remains enabled on tickets;
-- these policies are therefore required for the function to see the caller's
-- tenant-scoped row through auth.uid()/user_preferences.
DROP POLICY IF EXISTS user_preferences_owner_read ON user_preferences;
CREATE POLICY user_preferences_owner_read ON user_preferences
FOR SELECT TO fiberos_owner
USING (user_id = auth.uid());

DROP POLICY IF EXISTS technicians_owner_tenant_read ON technicians;
CREATE POLICY technicians_owner_tenant_read ON technicians
FOR SELECT TO fiberos_owner
USING (tenant_id = fiberos_current_tenant_id());

DROP POLICY IF EXISTS tickets_owner_transition_select ON tickets;
CREATE POLICY tickets_owner_transition_select ON tickets
FOR SELECT TO fiberos_owner
USING (tenant_id = fiberos_current_tenant_id());

DROP POLICY IF EXISTS tickets_owner_transition_update ON tickets;
CREATE POLICY tickets_owner_transition_update ON tickets
FOR UPDATE TO fiberos_owner
USING (tenant_id = fiberos_current_tenant_id())
WITH CHECK (tenant_id = fiberos_current_tenant_id());

CREATE OR REPLACE FUNCTION fiberos_guard_ticket_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF current_user <> 'fiberos_owner'
       OR current_setting('fiberos.lifecycle_transition', true) <> 'allowed' THEN
      RAISE EXCEPTION 'TICKET_STATUS_CHANGE_REQUIRES_LIFECYCLE_AUTHORITY';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

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

  -- The trusted definer role plus the row lock are the authorization boundary.
  -- The trigger rejects this marker from any other database role.
  PERFORM set_config('fiberos.lifecycle_transition','allowed',true);

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

REVOKE ALL ON FUNCTION fiberos_transition_ticket(uuid,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION fiberos_transition_ticket(uuid,text) TO authenticated;

COMMENT ON FUNCTION fiberos_transition_ticket(uuid,text) IS
  'DB-authoritative tenant-scoped ticket lifecycle transition. SECURITY DEFINER is constrained by fiberos_owner tenant-scoped RLS policies, row locking, role validation, and a definer-role-bound lifecycle trigger marker.';
