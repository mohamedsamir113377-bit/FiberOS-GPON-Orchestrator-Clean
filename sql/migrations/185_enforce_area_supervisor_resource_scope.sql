-- 185_enforce_area_supervisor_resource_scope.sql
-- Close tenant-wide PERMISSIVE-policy escapes for area_supervisor.
-- Scope comes only from DB-owned technician_subordinates and explicit ticket links.
BEGIN;

DO $$
DECLARE v record;
BEGIN
  SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole INTO v
  FROM pg_roles WHERE rolname='fiberos_policy_reader';
  IF NOT FOUND OR v.rolcanlogin IS DISTINCT FROM false OR v.rolsuper IS DISTINCT FROM false
     OR v.rolbypassrls IS DISTINCT FROM true OR v.rolcreatedb IS DISTINCT FROM false
     OR v.rolcreaterole IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FIBEROS_POLICY_READER_ROLE_UNSAFE';
  END IF;
  IF NOT pg_has_role('fiberos_owner','fiberos_policy_reader','MEMBER')
     OR NOT has_schema_privilege('fiberos_policy_reader','public','CREATE') THEN
    RAISE EXCEPTION 'FIBEROS_POLICY_READER_MIGRATION_WINDOW_REQUIRED';
  END IF;
  IF to_regprocedure('public.fiberos_field_technician_scope(uuid)') IS NULL THEN
    RAISE EXCEPTION 'FIBEROS_FIELD_SCOPE_PREDICATE_REQUIRED';
  END IF;
END $$;

GRANT SELECT (id,tenant_id,technician_id) ON public.tickets TO fiberos_policy_reader;
GRANT SELECT (id,tenant_id,ticket_id) ON public.call_sessions TO fiberos_policy_reader;
GRANT SELECT (id,tenant_id,call_session_id) ON public.contact_center_conversations TO fiberos_policy_reader;
GRANT SELECT (id,tenant_id,incident_id,entity_type,entity_id) ON public.incident_command_links TO fiberos_policy_reader;

SET ROLE fiberos_policy_reader;

CREATE OR REPLACE FUNCTION public.fiberos_area_supervisor_technician_scope(p_technician_id uuid,p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,auth AS $$
  SELECT p_technician_id IS NOT NULL AND p_tenant_id=public.fiberos_current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.technicians target
      WHERE target.id=p_technician_id AND target.tenant_id=p_tenant_id
        AND (target.user_id=auth.uid() OR EXISTS (
          SELECT 1 FROM public.technician_subordinates ts
          JOIN public.technicians supervisor
            ON supervisor.id=ts.supervisor_technician_id AND supervisor.tenant_id=ts.tenant_id
          WHERE ts.tenant_id=p_tenant_id AND ts.subordinate_technician_id=target.id
            AND ts.is_active=true AND supervisor.user_id=auth.uid()
        ))
    )
$$;

CREATE OR REPLACE FUNCTION public.fiberos_area_supervisor_ticket_scope(p_ticket_id uuid,p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,auth AS $$
  SELECT p_ticket_id IS NOT NULL AND p_tenant_id=public.fiberos_current_tenant_id()
    AND EXISTS (SELECT 1 FROM public.tickets tk
      WHERE tk.id=p_ticket_id AND tk.tenant_id=p_tenant_id
        AND public.fiberos_area_supervisor_technician_scope(tk.technician_id,tk.tenant_id))
$$;

CREATE OR REPLACE FUNCTION public.fiberos_current_user_ticket_scope(p_ticket_id uuid,p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,auth AS $$
  SELECT p_ticket_id IS NOT NULL AND p_tenant_id=public.fiberos_current_tenant_id()
    AND EXISTS (SELECT 1 FROM public.tickets tk
      JOIN public.technicians tech ON tech.id=tk.technician_id AND tech.tenant_id=tk.tenant_id
      WHERE tk.id=p_ticket_id AND tk.tenant_id=p_tenant_id
        AND tech.user_id=auth.uid() AND tech.is_active=true)
 $$;

CREATE OR REPLACE FUNCTION public.fiberos_area_supervisor_call_scope(p_call_id uuid,p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,auth AS $$
  SELECT p_call_id IS NOT NULL AND p_tenant_id=public.fiberos_current_tenant_id()
    AND EXISTS (SELECT 1 FROM public.call_sessions cs
      WHERE cs.id=p_call_id AND cs.tenant_id=p_tenant_id
        AND public.fiberos_area_supervisor_ticket_scope(cs.ticket_id,cs.tenant_id))
$$;

CREATE OR REPLACE FUNCTION public.fiberos_area_supervisor_conversation_scope(p_conversation_id uuid,p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,auth AS $$
  SELECT p_conversation_id IS NOT NULL AND p_tenant_id=public.fiberos_current_tenant_id()
    AND EXISTS (SELECT 1 FROM public.contact_center_conversations c
      WHERE c.id=p_conversation_id AND c.tenant_id=p_tenant_id
        AND public.fiberos_area_supervisor_call_scope(c.call_session_id,c.tenant_id))
$$;

CREATE OR REPLACE FUNCTION public.fiberos_area_supervisor_incident_scope(p_incident_id uuid,p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,auth AS $$
  SELECT p_incident_id IS NOT NULL AND p_tenant_id=public.fiberos_current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.incident_command_links l
      JOIN public.tickets tk ON tk.id=l.entity_id AND tk.tenant_id=l.tenant_id
      WHERE l.incident_id=p_incident_id AND l.tenant_id=p_tenant_id
        AND l.entity_type='ticket'
        AND public.fiberos_area_supervisor_ticket_scope(tk.id,tk.tenant_id)
    )
$$;

REVOKE ALL ON FUNCTION public.fiberos_area_supervisor_technician_scope(uuid,uuid)
  FROM PUBLIC,anon,fiberos_runtime,fiberos_worker,fiberos_owner;
REVOKE ALL ON FUNCTION public.fiberos_area_supervisor_ticket_scope(uuid,uuid)
  FROM PUBLIC,anon,fiberos_runtime,fiberos_worker,fiberos_owner;
REVOKE ALL ON FUNCTION public.fiberos_area_supervisor_call_scope(uuid,uuid)
  FROM PUBLIC,anon,fiberos_runtime,fiberos_worker,fiberos_owner;
REVOKE ALL ON FUNCTION public.fiberos_current_user_ticket_scope(uuid,uuid)
  FROM PUBLIC,anon,fiberos_runtime,fiberos_worker,fiberos_owner;
REVOKE ALL ON FUNCTION public.fiberos_area_supervisor_conversation_scope(uuid,uuid)
  FROM PUBLIC,anon,fiberos_runtime,fiberos_worker,fiberos_owner;
REVOKE ALL ON FUNCTION public.fiberos_area_supervisor_incident_scope(uuid,uuid)
  FROM PUBLIC,anon,fiberos_runtime,fiberos_worker,fiberos_owner;
GRANT EXECUTE ON FUNCTION public.fiberos_area_supervisor_technician_scope(uuid,uuid) TO authenticated,fiberos_app,fiberos_owner;
GRANT EXECUTE ON FUNCTION public.fiberos_area_supervisor_ticket_scope(uuid,uuid) TO authenticated,fiberos_app,fiberos_owner;
GRANT EXECUTE ON FUNCTION public.fiberos_area_supervisor_call_scope(uuid,uuid) TO authenticated,fiberos_app,fiberos_owner;
GRANT EXECUTE ON FUNCTION public.fiberos_current_user_ticket_scope(uuid,uuid) TO authenticated,fiberos_app,fiberos_owner;
GRANT EXECUTE ON FUNCTION public.fiberos_area_supervisor_conversation_scope(uuid,uuid) TO authenticated,fiberos_app,fiberos_owner;
GRANT EXECUTE ON FUNCTION public.fiberos_area_supervisor_incident_scope(uuid,uuid) TO authenticated,fiberos_app,fiberos_owner;
-- The existing incident-command trigger calls this tenant-consistency predicate.
-- Grant only the boolean tenant-check function required by the trusted insert path.
-- Switch to the policy owner before granting execution on the pre-existing tenant guard.
SET ROLE fiberos_owner;
GRANT EXECUTE ON FUNCTION public.fiberos_reality_entity_tenant_ok(text,uuid,uuid) TO authenticated,fiberos_app,fiberos_owner;

DROP POLICY IF EXISTS technicians_field_self_select ON public.technicians;
CREATE POLICY technicians_field_self_select ON public.technicians FOR SELECT TO authenticated
USING (tenant_id=public.fiberos_current_tenant_id() AND (
  user_id=auth.uid()
  OR (public.fiberos_has_any_role(ARRAY['team_lead']) AND public.fiberos_field_technician_scope(id))
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_technician_scope(id,tenant_id))
  OR public.fiberos_has_any_role(ARRAY['ops_manager','exec','sysadmin'])
));

DROP POLICY IF EXISTS technicians_select_tenant ON public.technicians;
CREATE POLICY technicians_select_tenant ON public.technicians FOR SELECT TO authenticated
USING (tenant_id=public.fiberos_current_tenant_id() AND (
  user_id=auth.uid() OR public.fiberos_has_any_role(ARRAY['ops_manager','exec','sysadmin','dispatcher','qc'])
));

DROP POLICY IF EXISTS technicians_update_tenant_management ON public.technicians;
CREATE POLICY technicians_update_tenant_management ON public.technicians FOR UPDATE TO authenticated
USING (tenant_id=public.fiberos_current_tenant_id() AND (
  user_id=auth.uid() OR public.fiberos_has_any_role(ARRAY['ops_manager','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_technician_scope(id,tenant_id))
))
WITH CHECK (tenant_id=public.fiberos_current_tenant_id() AND (
  user_id=auth.uid() OR public.fiberos_has_any_role(ARRAY['ops_manager','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_technician_scope(id,tenant_id))
));

CREATE OR REPLACE FUNCTION public.fiberos_guard_area_supervisor_technician_authority_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,auth AS $$
BEGIN
  IF public.fiberos_has_any_role(ARRAY['area_supervisor']) AND (
    NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.org_unit_id IS DISTINCT FROM OLD.org_unit_id OR NEW.is_active IS DISTINCT FROM OLD.is_active
    OR NEW.current_gps IS DISTINCT FROM OLD.current_gps OR NEW.skills IS DISTINCT FROM OLD.skills
  ) THEN
    RAISE EXCEPTION 'AREA_SUPERVISOR_CANNOT_MUTATE_TECHNICIAN_AUTHORITY_FIELDS' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fiberos_guard_area_supervisor_technician_authority_fields() FROM PUBLIC,anon;
DROP TRIGGER IF EXISTS trg_area_supervisor_technician_authority_fields ON public.technicians;
CREATE TRIGGER trg_area_supervisor_technician_authority_fields
BEFORE UPDATE OF tenant_id,user_id,org_unit_id,is_active,current_gps,skills ON public.technicians
FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_area_supervisor_technician_authority_fields();

DROP POLICY IF EXISTS technician_subordinates_scope_select ON public.technician_subordinates;
CREATE POLICY technician_subordinates_scope_select ON public.technician_subordinates FOR SELECT TO authenticated
USING (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_has_any_role(ARRAY['ops_manager','exec','sysadmin'])
  OR supervisor_technician_id IN (SELECT id FROM public.technicians WHERE user_id=auth.uid() AND tenant_id=public.fiberos_current_tenant_id())
  OR subordinate_technician_id IN (SELECT id FROM public.technicians WHERE user_id=auth.uid() AND tenant_id=public.fiberos_current_tenant_id())
));
DROP POLICY IF EXISTS technician_subordinates_scope_write ON public.technician_subordinates;
CREATE POLICY technician_subordinates_scope_write ON public.technician_subordinates FOR ALL TO authenticated
USING (tenant_id=public.fiberos_current_tenant_id() AND public.fiberos_has_any_role(ARRAY['ops_manager','sysadmin']))
WITH CHECK (tenant_id=public.fiberos_current_tenant_id() AND public.fiberos_has_any_role(ARRAY['ops_manager','sysadmin']));

DROP POLICY IF EXISTS tickets_field_scope_select ON public.tickets;
CREATE POLICY tickets_field_scope_select ON public.tickets FOR SELECT TO authenticated
USING (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_has_any_role(ARRAY['ops_manager','exec','sysadmin','qc','dispatcher'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_ticket_scope(id,tenant_id))
  OR (public.fiberos_has_any_role(ARRAY['team_lead']) AND public.fiberos_area_supervisor_ticket_scope(id,tenant_id))
  OR public.fiberos_ticket_is_owned(technician_id)
));
DROP POLICY IF EXISTS tickets_select_tenant ON public.tickets;
CREATE POLICY tickets_select_tenant ON public.tickets FOR SELECT TO authenticated
USING (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_ticket_is_owned(technician_id)
  OR public.fiberos_has_any_role(ARRAY['qc','ops_manager','exec','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_ticket_scope(id,tenant_id))
));
DROP POLICY IF EXISTS tickets_insert_tenant ON public.tickets;
CREATE POLICY tickets_insert_tenant ON public.tickets FOR INSERT TO authenticated
WITH CHECK (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_ticket_is_owned(technician_id)
  OR public.fiberos_has_any_role(ARRAY['qc','ops_manager','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND technician_id IS NOT NULL
      AND public.fiberos_area_supervisor_technician_scope(technician_id,tenant_id))
));
DROP POLICY IF EXISTS tickets_update_tenant_nonstatus ON public.tickets;
CREATE POLICY tickets_update_tenant_nonstatus ON public.tickets FOR UPDATE TO authenticated
USING (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_ticket_is_owned(technician_id)
  OR public.fiberos_has_any_role(ARRAY['qc','ops_manager','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND technician_id IS NOT NULL
      AND public.fiberos_area_supervisor_technician_scope(technician_id,tenant_id))
))
WITH CHECK (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_ticket_is_owned(technician_id)
  OR public.fiberos_has_any_role(ARRAY['qc','ops_manager','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND technician_id IS NOT NULL
      AND public.fiberos_area_supervisor_technician_scope(technician_id,tenant_id))
));
DROP POLICY IF EXISTS tickets_app_kpi_read ON public.tickets;
CREATE POLICY tickets_app_kpi_read ON public.tickets FOR SELECT TO fiberos_app
USING (public.fiberos_enterprise_tenant_ok(tenant_id) AND (
  public.fiberos_has_any_role(ARRAY['call_center','ops_manager','exec','sysadmin','qc','dispatcher'])
  OR public.fiberos_current_user_ticket_scope(id,tenant_id)
  OR ((public.fiberos_has_any_role(ARRAY['area_supervisor','team_lead']))
      AND public.fiberos_area_supervisor_ticket_scope(id,tenant_id))
));

DROP POLICY IF EXISTS evidence_field_scope_select ON public.evidence;
CREATE POLICY evidence_field_scope_select ON public.evidence FOR SELECT TO authenticated
USING (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_has_any_role(ARRAY['ops_manager','exec','sysadmin','qc','dispatcher'])
  OR ((public.fiberos_has_any_role(ARRAY['area_supervisor','team_lead']))
      AND public.fiberos_area_supervisor_ticket_scope(ticket_id,tenant_id))
  OR EXISTS (SELECT 1 FROM public.tickets tk WHERE tk.id=evidence.ticket_id AND tk.tenant_id=evidence.tenant_id
             AND (public.fiberos_ticket_is_owned(tk.technician_id)
              OR (public.fiberos_has_any_role(ARRAY['team_lead'])
                  AND public.fiberos_area_supervisor_ticket_scope(tk.id,tk.tenant_id))
              OR (public.fiberos_has_any_role(ARRAY['area_supervisor'])
                  AND public.fiberos_area_supervisor_ticket_scope(tk.id,tk.tenant_id))))
));
DROP POLICY IF EXISTS evidence_select_tenant ON public.evidence;
CREATE POLICY evidence_select_tenant ON public.evidence FOR SELECT TO authenticated
USING (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_ticket_is_owned((SELECT tk.technician_id FROM public.tickets tk
    WHERE tk.id=evidence.ticket_id AND tk.tenant_id=evidence.tenant_id))
  OR public.fiberos_has_any_role(ARRAY['qc','ops_manager','exec','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_ticket_scope(ticket_id,tenant_id))
));
DROP POLICY IF EXISTS evidence_insert_tenant ON public.evidence;
CREATE POLICY evidence_insert_tenant ON public.evidence FOR INSERT TO authenticated
WITH CHECK (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_ticket_is_owned((SELECT tk.technician_id FROM public.tickets tk
    WHERE tk.id=evidence.ticket_id AND tk.tenant_id=evidence.tenant_id))
  OR public.fiberos_has_any_role(ARRAY['qc','ops_manager','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_ticket_scope(ticket_id,tenant_id))
));
DROP POLICY IF EXISTS evidence_select_fiberos_app ON public.evidence;
CREATE POLICY evidence_select_fiberos_app ON public.evidence FOR SELECT TO fiberos_app
USING (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_has_any_role(ARRAY['call_center','ops_manager','exec','sysadmin','qc','dispatcher'])
  OR public.fiberos_current_user_ticket_scope(ticket_id,tenant_id)
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor','team_lead'])
      AND public.fiberos_area_supervisor_ticket_scope(ticket_id,tenant_id))
));
DROP POLICY IF EXISTS evidence_insert_fiberos_app ON public.evidence;
CREATE POLICY evidence_insert_fiberos_app ON public.evidence FOR INSERT TO fiberos_app
WITH CHECK (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_has_any_role(ARRAY['call_center','ops_manager','sysadmin','qc'])
  OR public.fiberos_current_user_ticket_scope(ticket_id,tenant_id)
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor','team_lead'])
      AND public.fiberos_area_supervisor_ticket_scope(ticket_id,tenant_id))
));

DROP POLICY IF EXISTS technician_positions_select_scope ON public.technician_positions;
CREATE POLICY technician_positions_select_scope ON public.technician_positions FOR SELECT
USING (EXISTS (SELECT 1 FROM public.technicians t JOIN public.user_preferences up ON up.user_id=t.user_id
  WHERE t.id=technician_positions.technician_id AND t.tenant_id=technician_positions.tenant_id
    AND up.tenant_id=public.fiberos_current_tenant_id()
    AND (t.user_id=auth.uid()
      OR public.fiberos_has_any_role(ARRAY['qc','ops_manager','exec','dispatcher','sysadmin'])
      OR (public.fiberos_has_any_role(ARRAY['field_tech','technician']) AND t.user_id=auth.uid())
      OR (public.fiberos_has_any_role(ARRAY['team_lead']) AND public.fiberos_field_technician_scope(t.id))
      OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_technician_scope(t.id,t.tenant_id))
)));
DROP POLICY IF EXISTS technician_positions_app_kpi_read ON public.technician_positions;
CREATE POLICY technician_positions_app_kpi_read ON public.technician_positions FOR SELECT TO fiberos_app
USING (public.fiberos_enterprise_tenant_ok(tenant_id) AND (
  public.fiberos_has_any_role(ARRAY['qc','ops_manager','exec','dispatcher','sysadmin'])
  OR public.fiberos_ticket_is_owned(technician_id)
  OR (public.fiberos_has_any_role(ARRAY['team_lead']) AND public.fiberos_field_technician_scope(technician_id))
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_technician_scope(technician_id,tenant_id))
));
DROP POLICY IF EXISTS technician_positions_insert_owner_or_management ON public.technician_positions;
CREATE POLICY technician_positions_insert_owner_or_management ON public.technician_positions FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.technicians t JOIN public.user_preferences up ON up.user_id=t.user_id
  WHERE t.id=technician_positions.technician_id AND t.tenant_id=technician_positions.tenant_id
    AND up.tenant_id=public.fiberos_current_tenant_id()
    AND (t.user_id=auth.uid() OR public.fiberos_has_any_role(ARRAY['ops_manager','dispatcher','sysadmin'])
      OR (public.fiberos_has_any_role(ARRAY['field_tech','technician']) AND t.user_id=auth.uid())
)));

DROP POLICY IF EXISTS technician_role_assignments_scope ON public.technician_role_assignments;
CREATE POLICY technician_role_assignments_scope ON public.technician_role_assignments FOR SELECT
USING ((tenant_id IN (SELECT tenant_id FROM public.user_preferences WHERE user_id=auth.uid())
  OR public.fiberos_has_any_role(ARRAY['ops_manager','dispatcher','qc','sysadmin']))
  AND (
    (NOT public.fiberos_has_any_role(ARRAY['area_supervisor']) OR public.fiberos_area_supervisor_technician_scope(technician_id,tenant_id))
    AND (NOT public.fiberos_has_any_role(ARRAY['team_lead']) OR public.fiberos_field_technician_scope(technician_id))
    AND (NOT public.fiberos_has_any_role(ARRAY['field_tech','technician']) OR public.fiberos_ticket_is_owned(technician_id))
  ));
DROP POLICY IF EXISTS technician_role_assignments_app_kpi_read ON public.technician_role_assignments;
CREATE POLICY technician_role_assignments_app_kpi_read ON public.technician_role_assignments FOR SELECT TO fiberos_app
USING (public.fiberos_enterprise_tenant_ok(tenant_id) AND (
  public.fiberos_has_any_role(ARRAY['qc','ops_manager','dispatcher','exec','sysadmin'])
  OR public.fiberos_ticket_is_owned(technician_id)
  OR (public.fiberos_has_any_role(ARRAY['team_lead']) AND public.fiberos_field_technician_scope(technician_id))
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_technician_scope(technician_id,tenant_id))
));
DROP POLICY IF EXISTS technician_role_assignments_management ON public.technician_role_assignments;
CREATE POLICY technician_role_assignments_management ON public.technician_role_assignments FOR INSERT
WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.user_preferences WHERE user_id=auth.uid())
  AND public.fiberos_has_any_role(ARRAY['ops_manager','sysadmin']));

DROP POLICY IF EXISTS ticket_worker_assignments_scope ON public.ticket_worker_assignments;
CREATE POLICY ticket_worker_assignments_scope ON public.ticket_worker_assignments FOR SELECT
USING ((tenant_id IN (SELECT tenant_id FROM public.user_preferences WHERE user_id=auth.uid())
  OR public.fiberos_has_any_role(ARRAY['ops_manager','dispatcher','qc','sysadmin']))
  AND (
    (NOT public.fiberos_has_any_role(ARRAY['area_supervisor'])
      OR (public.fiberos_area_supervisor_technician_scope(technician_id,tenant_id)
          AND public.fiberos_area_supervisor_ticket_scope(ticket_id,tenant_id)))
    AND (NOT public.fiberos_has_any_role(ARRAY['team_lead'])
      OR (public.fiberos_field_technician_scope(technician_id)
          AND public.fiberos_area_supervisor_ticket_scope(ticket_id,tenant_id)))
    AND (NOT public.fiberos_has_any_role(ARRAY['field_tech','technician'])
      OR public.fiberos_ticket_is_owned(technician_id))
  ));
DROP POLICY IF EXISTS ticket_worker_assignments_management ON public.ticket_worker_assignments;
CREATE POLICY ticket_worker_assignments_management ON public.ticket_worker_assignments FOR INSERT
WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.user_preferences WHERE user_id=auth.uid())
  AND (public.fiberos_has_any_role(ARRAY['ops_manager','dispatcher','sysadmin'])
    OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND role_code IN ('technician','fiber_splicer','welder','cable_worker')
       AND public.fiberos_area_supervisor_technician_scope(technician_id,tenant_id)
       AND public.fiberos_area_supervisor_ticket_scope(ticket_id,tenant_id))));

DROP POLICY IF EXISTS dispatch_requests_scope_select ON public.dispatch_requests;
CREATE POLICY dispatch_requests_scope_select ON public.dispatch_requests FOR SELECT
USING (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_has_any_role(ARRAY['dispatcher','ops_manager','exec','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_ticket_scope(ticket_id,tenant_id))
));
DROP POLICY IF EXISTS dispatch_requests_scope_insert ON public.dispatch_requests;
CREATE POLICY dispatch_requests_scope_insert ON public.dispatch_requests FOR INSERT
WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.user_preferences WHERE user_id=auth.uid()) AND (
  public.fiberos_has_any_role(ARRAY['dispatcher','ops_manager','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_ticket_scope(ticket_id,tenant_id))
));

DROP POLICY IF EXISTS call_sessions_scope_select ON public.call_sessions;
CREATE POLICY call_sessions_scope_select ON public.call_sessions FOR SELECT
USING (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_has_any_role(ARRAY['call_center','ops_manager','exec','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_ticket_scope(ticket_id,tenant_id))
));
DROP POLICY IF EXISTS call_sessions_scope_insert ON public.call_sessions;
CREATE POLICY call_sessions_scope_insert ON public.call_sessions FOR INSERT
WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.user_preferences WHERE user_id=auth.uid()) AND (
  public.fiberos_has_any_role(ARRAY['call_center','ops_manager','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_ticket_scope(ticket_id,tenant_id))
));
DROP POLICY IF EXISTS call_sessions_scope_update ON public.call_sessions;
CREATE POLICY call_sessions_scope_update ON public.call_sessions FOR UPDATE
USING (tenant_id IN (SELECT tenant_id FROM public.user_preferences WHERE user_id=auth.uid()) AND (
  public.fiberos_has_any_role(ARRAY['call_center','ops_manager','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_ticket_scope(ticket_id,tenant_id))
))
WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.user_preferences WHERE user_id=auth.uid()) AND (
  public.fiberos_has_any_role(ARRAY['call_center','ops_manager','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_ticket_scope(ticket_id,tenant_id))
));

DROP POLICY IF EXISTS call_events_scope_select ON public.call_events;
CREATE POLICY call_events_scope_select ON public.call_events FOR SELECT
USING (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_has_any_role(ARRAY['call_center','ops_manager','exec','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_call_scope(call_session_id,tenant_id))
));
DROP POLICY IF EXISTS call_events_scope_insert ON public.call_events;
CREATE POLICY call_events_scope_insert ON public.call_events FOR INSERT
WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.user_preferences WHERE user_id=auth.uid()) AND (
  public.fiberos_has_any_role(ARRAY['call_center','ops_manager','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_call_scope(call_session_id,tenant_id))
));

DROP POLICY IF EXISTS call_dispositions_select ON public.call_dispositions;
CREATE POLICY call_dispositions_select ON public.call_dispositions FOR SELECT
USING (public.fiberos_enterprise_tenant_ok(tenant_id) AND (
  public.fiberos_has_any_role(ARRAY['call_center','ops_manager','exec','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_call_scope(call_session_id,tenant_id))
));
DROP POLICY IF EXISTS call_dispositions_app_write ON public.call_dispositions;
CREATE POLICY call_dispositions_app_write ON public.call_dispositions FOR ALL TO fiberos_app
USING (public.fiberos_enterprise_tenant_ok(tenant_id) AND (
  public.fiberos_has_any_role(ARRAY['call_center','ops_manager','exec','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_call_scope(call_session_id,tenant_id))
))
WITH CHECK (public.fiberos_enterprise_tenant_ok(tenant_id) AND (
  public.fiberos_has_any_role(ARRAY['call_center','ops_manager','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_call_scope(call_session_id,tenant_id))
));

DROP POLICY IF EXISTS cc_conversations_app ON public.contact_center_conversations;
CREATE POLICY cc_conversations_app ON public.contact_center_conversations FOR ALL TO fiberos_app
USING (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_has_any_role(ARRAY['call_center','ops_manager','exec','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_call_scope(call_session_id,tenant_id))
))
WITH CHECK (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_has_any_role(ARRAY['call_center','ops_manager','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_call_scope(call_session_id,tenant_id))
));
DROP POLICY IF EXISTS cc_conversations_scope ON public.contact_center_conversations;
CREATE POLICY cc_conversations_scope ON public.contact_center_conversations FOR ALL TO authenticated
USING (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_has_any_role(ARRAY['call_center','ops_manager','exec','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_call_scope(call_session_id,tenant_id))
))
WITH CHECK (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_has_any_role(ARRAY['call_center','ops_manager','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_call_scope(call_session_id,tenant_id))
));

DROP POLICY IF EXISTS cc_messages_app ON public.contact_center_conversation_messages;
CREATE POLICY cc_messages_app ON public.contact_center_conversation_messages FOR ALL TO fiberos_app
USING (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_has_any_role(ARRAY['call_center','ops_manager','exec','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_conversation_scope(conversation_id,tenant_id))
))
WITH CHECK (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_has_any_role(ARRAY['call_center','ops_manager','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_conversation_scope(conversation_id,tenant_id))
));
DROP POLICY IF EXISTS cc_messages_scope ON public.contact_center_conversation_messages;
CREATE POLICY cc_messages_scope ON public.contact_center_conversation_messages FOR ALL TO authenticated
USING (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_has_any_role(ARRAY['call_center','ops_manager','exec','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_conversation_scope(conversation_id,tenant_id))
))
WITH CHECK (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_has_any_role(ARRAY['call_center','ops_manager','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_conversation_scope(conversation_id,tenant_id))
));

DROP POLICY IF EXISTS rework_cases_tenant_scope ON public.rework_cases;
CREATE POLICY rework_cases_tenant_scope ON public.rework_cases FOR SELECT
USING (tenant_id IN (SELECT tenant_id FROM public.user_preferences WHERE user_id=auth.uid())
  AND public.fiberos_has_any_role(ARRAY['exec','ops_manager','area_supervisor','qc','sysadmin'])
  AND (NOT public.fiberos_has_any_role(ARRAY['area_supervisor']) OR public.fiberos_area_supervisor_ticket_scope(ticket_id,tenant_id)));
DROP POLICY IF EXISTS rework_cases_tenant_insert ON public.rework_cases;
CREATE POLICY rework_cases_tenant_insert ON public.rework_cases FOR INSERT
WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.user_preferences WHERE user_id=auth.uid())
  AND reported_by=auth.uid()
  AND (NOT public.fiberos_has_any_role(ARRAY['area_supervisor']) OR public.fiberos_area_supervisor_ticket_scope(ticket_id,tenant_id)));

-- Incident scope requires a trusted existing ticket link. Area supervisors can extend
-- an existing in-scope incident only with another already in-scope ticket link.
DROP POLICY IF EXISTS incident_command_links_select ON public.incident_command_links;
CREATE POLICY incident_command_links_select ON public.incident_command_links FOR SELECT TO authenticated
USING (tenant_id=public.fiberos_current_tenant_id() AND (
  NOT public.fiberos_has_any_role(ARRAY['area_supervisor'])
  OR (entity_type='ticket' AND public.fiberos_area_supervisor_ticket_scope(entity_id,tenant_id))
  OR public.fiberos_area_supervisor_incident_scope(incident_id,tenant_id)
));
DROP POLICY IF EXISTS incident_command_links_insert ON public.incident_command_links;
CREATE POLICY incident_command_links_insert ON public.incident_command_links FOR INSERT TO authenticated
WITH CHECK (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_has_any_role(ARRAY['ops_manager','dispatcher','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND entity_type='ticket'
      AND public.fiberos_area_supervisor_ticket_scope(entity_id,tenant_id)
      AND public.fiberos_area_supervisor_incident_scope(incident_id,tenant_id))
));

DROP POLICY IF EXISTS incidents_scope_select ON public.incidents;
CREATE POLICY incidents_scope_select ON public.incidents FOR SELECT
USING (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_has_any_role(ARRAY['ops_manager','exec','dispatcher','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_incident_scope(id,tenant_id))
));
DROP POLICY IF EXISTS incidents_scope_write ON public.incidents;
DROP POLICY IF EXISTS incidents_scope_insert ON public.incidents;
CREATE POLICY incidents_scope_insert ON public.incidents FOR INSERT
WITH CHECK (tenant_id=public.fiberos_current_tenant_id() AND public.fiberos_has_any_role(ARRAY['ops_manager','dispatcher','sysadmin']));
DROP POLICY IF EXISTS incidents_scope_update ON public.incidents;
CREATE POLICY incidents_scope_update ON public.incidents FOR UPDATE
USING (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_has_any_role(ARRAY['ops_manager','dispatcher','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_incident_scope(id,tenant_id))
))
WITH CHECK (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_has_any_role(ARRAY['ops_manager','dispatcher','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_incident_scope(id,tenant_id))
));
DROP POLICY IF EXISTS incidents_scope_delete ON public.incidents;
CREATE POLICY incidents_scope_delete ON public.incidents FOR DELETE
USING (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_has_any_role(ARRAY['ops_manager','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_incident_scope(id,tenant_id))
));

DROP POLICY IF EXISTS incident_events_scope_select ON public.incident_events;
CREATE POLICY incident_events_scope_select ON public.incident_events FOR SELECT
USING (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_has_any_role(ARRAY['ops_manager','exec','dispatcher','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_incident_scope(incident_id,tenant_id))
));
DROP POLICY IF EXISTS incident_events_scope_insert ON public.incident_events;
CREATE POLICY incident_events_scope_insert ON public.incident_events FOR INSERT
WITH CHECK (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_has_any_role(ARRAY['ops_manager','dispatcher','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_incident_scope(incident_id,tenant_id))
));

DROP POLICY IF EXISTS operational_event_incident_links_select ON public.operational_event_incident_links;
CREATE POLICY operational_event_incident_links_select ON public.operational_event_incident_links FOR SELECT TO authenticated
USING (tenant_id=public.fiberos_current_tenant_id() AND (
  NOT public.fiberos_has_any_role(ARRAY['area_supervisor']) OR public.fiberos_area_supervisor_incident_scope(incident_id,tenant_id)
));
DROP POLICY IF EXISTS operational_event_incident_links_insert ON public.operational_event_incident_links;
CREATE POLICY operational_event_incident_links_insert ON public.operational_event_incident_links FOR INSERT TO authenticated
WITH CHECK (tenant_id=public.fiberos_current_tenant_id() AND (
  public.fiberos_has_any_role(ARRAY['call_center','ops_manager','dispatcher','exec','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND public.fiberos_area_supervisor_incident_scope(incident_id,tenant_id))
));

DROP POLICY IF EXISTS evidence_chain_certificates_select ON public.evidence_chain_certificates;
CREATE POLICY evidence_chain_certificates_select ON public.evidence_chain_certificates FOR SELECT
USING (public.fiberos_enterprise_tenant_ok(tenant_id) AND (
  public.fiberos_has_any_role(ARRAY['qc','ops_manager','exec','dispatcher','sysadmin'])
  OR public.fiberos_current_user_ticket_scope(ticket_id,tenant_id)
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor','team_lead'])
      AND public.fiberos_area_supervisor_ticket_scope(ticket_id,tenant_id))
));
DROP POLICY IF EXISTS evidence_chain_certificates_insert ON public.evidence_chain_certificates;
CREATE POLICY evidence_chain_certificates_insert ON public.evidence_chain_certificates FOR INSERT
WITH CHECK (public.fiberos_enterprise_tenant_ok(tenant_id) AND (
  public.fiberos_has_any_role(ARRAY['qc','ops_manager','dispatcher','sysadmin'])
  OR public.fiberos_current_user_ticket_scope(ticket_id,tenant_id)
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor','team_lead'])
      AND public.fiberos_area_supervisor_ticket_scope(ticket_id,tenant_id))
));
DROP POLICY IF EXISTS material_reel_ledger_select ON public.material_reel_ledger;
CREATE POLICY material_reel_ledger_select ON public.material_reel_ledger FOR SELECT TO authenticated
USING (public.fiberos_enterprise_tenant_ok(tenant_id) AND (
  public.fiberos_has_any_role(ARRAY['warehouse','dispatcher','ops_manager','exec','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND ticket_id IS NOT NULL
      AND public.fiberos_area_supervisor_ticket_scope(ticket_id,tenant_id))
));
DROP POLICY IF EXISTS material_reel_ledger_app_read ON public.material_reel_ledger;
CREATE POLICY material_reel_ledger_app_read ON public.material_reel_ledger FOR SELECT TO fiberos_app
USING (public.fiberos_enterprise_tenant_ok(tenant_id) AND (
  public.fiberos_has_any_role(ARRAY['warehouse','dispatcher','ops_manager','exec','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND ticket_id IS NOT NULL
      AND public.fiberos_area_supervisor_ticket_scope(ticket_id,tenant_id))
));
DROP POLICY IF EXISTS material_reel_ledger_insert ON public.material_reel_ledger;
CREATE POLICY material_reel_ledger_insert ON public.material_reel_ledger FOR INSERT TO authenticated
WITH CHECK (public.fiberos_enterprise_tenant_ok(tenant_id) AND (
  public.fiberos_has_any_role(ARRAY['warehouse','ops_manager','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['area_supervisor']) AND ticket_id IS NOT NULL
      AND public.fiberos_area_supervisor_ticket_scope(ticket_id,tenant_id))
));
DROP POLICY IF EXISTS splice_records_scope ON public.splice_records;
CREATE POLICY splice_records_scope ON public.splice_records FOR SELECT
USING (tenant_id IN (SELECT tenant_id FROM public.user_preferences WHERE user_id=auth.uid()) AND (
  public.fiberos_has_any_role(ARRAY['ops_manager','qc','sysadmin'])
  OR public.fiberos_ticket_is_owned(worker_id)
  OR (public.fiberos_has_any_role(ARRAY['team_lead','area_supervisor'])
      AND public.fiberos_area_supervisor_technician_scope(worker_id,tenant_id)
      AND (ticket_id IS NULL OR public.fiberos_area_supervisor_ticket_scope(ticket_id,tenant_id)))
));
DROP POLICY IF EXISTS splice_records_insert ON public.splice_records;
CREATE POLICY splice_records_insert ON public.splice_records FOR INSERT
WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.user_preferences WHERE user_id=auth.uid()) AND (
  public.fiberos_has_any_role(ARRAY['ops_manager','qc','sysadmin'])
  OR (public.fiberos_has_any_role(ARRAY['technician','fiber_splicer','welder'])
      AND public.fiberos_ticket_is_owned(worker_id)
      AND (ticket_id IS NULL OR public.fiberos_current_user_ticket_scope(ticket_id,tenant_id)))
  OR (public.fiberos_has_any_role(ARRAY['team_lead','area_supervisor'])
      AND public.fiberos_area_supervisor_technician_scope(worker_id,tenant_id)
      AND (ticket_id IS NULL OR public.fiberos_area_supervisor_ticket_scope(ticket_id,tenant_id)))
));
COMMIT;
