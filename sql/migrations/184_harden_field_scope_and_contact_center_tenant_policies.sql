-- 184_harden_field_scope_and_contact_center_tenant_policies.sql
-- Repair field technician scope hardening and contact-center tenant correlation.
-- Additive correction: historical migrations 113/154 remain byte-identical.
BEGIN;

DO $$
DECLARE
  v_role record;
BEGIN
  SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
    INTO v_role
    FROM pg_roles
   WHERE rolname = 'fiberos_policy_reader';

  IF NOT FOUND
     OR v_role.rolcanlogin IS DISTINCT FROM false
     OR v_role.rolsuper IS DISTINCT FROM false
     OR v_role.rolbypassrls IS DISTINCT FROM true
     OR v_role.rolcreatedb IS DISTINCT FROM false
     OR v_role.rolcreaterole IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FIBEROS_POLICY_READER_ROLE_UNSAFE';
  END IF;

  IF NOT pg_has_role('fiberos_owner', 'fiberos_policy_reader', 'MEMBER') THEN
    RAISE EXCEPTION 'FIBEROS_POLICY_READER_MEMBERSHIP_REQUIRED: DBA must temporarily grant fiberos_policy_reader to fiberos_owner for this migration, then rerun sql/bootstrap/20_runtime_role_grants.sql';
  END IF;

  IF NOT has_schema_privilege('fiberos_policy_reader', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'FIBEROS_POLICY_READER_PUBLIC_CREATE_REQUIRED: DBA must temporarily grant CREATE ON SCHEMA public TO fiberos_policy_reader for this migration, then rerun sql/bootstrap/20_runtime_role_grants.sql';
  END IF;
END
$$;

-- The predicate is intentionally owned by the constrained NOLOGIN policy-reader
-- role. BYPASSRLS on that role is the explicit isolation boundary; no function-
-- local row_security=off setting is needed or permitted.
SET ROLE fiberos_policy_reader;
CREATE OR REPLACE FUNCTION public.fiberos_field_technician_scope(p_technician_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.technicians AS target
    WHERE target.id = p_technician_id
      AND target.tenant_id = public.fiberos_current_tenant_id()
      AND (
        target.user_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.technician_subordinates AS ts
          JOIN public.technicians AS supervisor
            ON supervisor.id = ts.supervisor_technician_id
          WHERE ts.tenant_id = target.tenant_id
            AND ts.subordinate_technician_id = target.id
            AND ts.is_active = true
            AND supervisor.tenant_id = target.tenant_id
            AND supervisor.user_id = auth.uid()
        )
      )
  );
END
$$;

REVOKE ALL ON FUNCTION public.fiberos_field_technician_scope(uuid)
  FROM PUBLIC, anon, fiberos_runtime, fiberos_worker, fiberos_app, fiberos_owner;
GRANT EXECUTE ON FUNCTION public.fiberos_field_technician_scope(uuid) TO authenticated;
COMMENT ON FUNCTION public.fiberos_field_technician_scope(uuid) IS
  'Boolean-only, tenant-bound field/supervisor scope predicate. Owned by NOLOGIN BYPASSRLS fiberos_policy_reader with pinned search_path; function-local row_security override is prohibited.';

SET ROLE fiberos_owner;

DROP POLICY IF EXISTS cc_messages_customer ON public.contact_center_conversation_messages;
CREATE POLICY cc_messages_customer ON public.contact_center_conversation_messages
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.fiberos_current_tenant_id()
    AND public.fiberos_has_any_role(ARRAY['customer'])
    AND EXISTS (
      SELECT 1
      FROM public.contact_center_conversations AS c
      WHERE c.id = public.contact_center_conversation_messages.conversation_id
        AND c.tenant_id = public.contact_center_conversation_messages.tenant_id
        AND c.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS cc_messages_customer_insert ON public.contact_center_conversation_messages;
CREATE POLICY cc_messages_customer_insert ON public.contact_center_conversation_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.fiberos_current_tenant_id()
    AND public.fiberos_has_any_role(ARRAY['customer'])
    AND EXISTS (
      SELECT 1
      FROM public.contact_center_conversations AS c
      WHERE c.id = public.contact_center_conversation_messages.conversation_id
        AND c.tenant_id = public.contact_center_conversation_messages.tenant_id
        AND c.created_by = auth.uid()
    )
  );

COMMIT;
