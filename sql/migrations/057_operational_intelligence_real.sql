-- 057_operational_intelligence_real.sql
-- Real persisted payment-cycle and rework-root-cause execution.
-- No synthetic SLA, delivery, payment, or analytics results are generated.
BEGIN;

CREATE TABLE IF NOT EXISTS payment_cycles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    state text NOT NULL CHECK (state IN ('submitted','approved','rejected','paid')),
    rejection_reason text,
    actor_id uuid,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_cycle_active_invoice
    ON payment_cycles(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_cycles_tenant_time
    ON payment_cycles(tenant_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS payment_cycle_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    payment_cycle_id uuid NOT NULL REFERENCES payment_cycles(id) ON DELETE CASCADE,
    from_state text,
    to_state text NOT NULL CHECK (to_state IN ('submitted','approved','rejected','paid')),
    actor_id uuid,
    evidence_reference text,
    occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_cycle_events_cycle_time
    ON payment_cycle_events(payment_cycle_id, occurred_at DESC);

ALTER TABLE payment_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_cycle_events ENABLE ROW LEVEL SECURITY;

-- DB authority: clients may only create a cycle for their own tenant and the
-- initial state is always submitted. Event rows are append-only and tenant-bound.
DROP POLICY IF EXISTS payment_cycles_tenant_insert ON payment_cycles;
CREATE POLICY payment_cycles_tenant_insert ON payment_cycles
FOR INSERT TO authenticated WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
    AND state = 'submitted'
    AND actor_id = auth.uid()
);
DROP POLICY IF EXISTS payment_cycles_tenant_update ON payment_cycles;
CREATE POLICY payment_cycles_tenant_update ON payment_cycles
FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS payment_cycles_tenant_delete ON payment_cycles;
CREATE POLICY payment_cycles_tenant_delete ON payment_cycles
FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS payment_cycle_events_tenant_insert ON payment_cycle_events;
CREATE POLICY payment_cycle_events_tenant_insert ON payment_cycle_events
FOR INSERT TO authenticated WITH CHECK (false);
DROP POLICY IF EXISTS payment_cycle_events_tenant_update ON payment_cycle_events;
CREATE POLICY payment_cycle_events_tenant_update ON payment_cycle_events
FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS payment_cycle_events_tenant_delete ON payment_cycle_events;
CREATE POLICY payment_cycle_events_tenant_delete ON payment_cycle_events
FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS payment_cycles_tenant_scope ON payment_cycles;
CREATE POLICY payment_cycles_tenant_scope ON payment_cycles
FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
    OR fiberos_has_any_role(ARRAY['cfo','exec','ops_manager','sysadmin'])
);
DROP POLICY IF EXISTS payment_cycle_events_tenant_scope ON payment_cycle_events;
CREATE POLICY payment_cycle_events_tenant_scope ON payment_cycle_events
FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
    OR fiberos_has_any_role(ARRAY['cfo','exec','ops_manager','sysadmin'])
);

CREATE TABLE IF NOT EXISTS rework_cases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    case_id text NOT NULL,
    ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL,
    root_cause_category text NOT NULL CHECK (length(trim(root_cause_category)) > 0),
    reported_by uuid,
    evidence_reference text NOT NULL CHECK (length(trim(evidence_reference)) > 0),
    resolution_action text,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    opened_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz,
    UNIQUE (tenant_id, case_id)
);
CREATE INDEX IF NOT EXISTS idx_rework_cases_tenant_status
    ON rework_cases(tenant_id, status, opened_at DESC);

CREATE TABLE IF NOT EXISTS rework_case_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rework_case_id uuid NOT NULL REFERENCES rework_cases(id) ON DELETE CASCADE,
    event_type text NOT NULL CHECK (event_type IN ('opened','closed')),
    actor_id uuid,
    evidence_reference text,
    resolution_action text,
    occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rework_case_events_case_time
    ON rework_case_events(rework_case_id, occurred_at DESC);

ALTER TABLE rework_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE rework_case_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rework_cases_tenant_insert ON rework_cases;
CREATE POLICY rework_cases_tenant_insert ON rework_cases
FOR INSERT TO authenticated WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
    AND reported_by = auth.uid()
);
DROP POLICY IF EXISTS rework_cases_tenant_update ON rework_cases;
CREATE POLICY rework_cases_tenant_update ON rework_cases
FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS rework_cases_tenant_delete ON rework_cases;
CREATE POLICY rework_cases_tenant_delete ON rework_cases
FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS rework_case_events_tenant_insert ON rework_case_events;
CREATE POLICY rework_case_events_tenant_insert ON rework_case_events
FOR INSERT TO authenticated WITH CHECK (false);
DROP POLICY IF EXISTS rework_case_events_tenant_update ON rework_case_events;
CREATE POLICY rework_case_events_tenant_update ON rework_case_events
FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS rework_case_events_tenant_delete ON rework_case_events;
CREATE POLICY rework_case_events_tenant_delete ON rework_case_events
FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS rework_cases_tenant_scope ON rework_cases;
CREATE POLICY rework_cases_tenant_scope ON rework_cases
FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
    OR fiberos_has_any_role(ARRAY['exec','ops_manager','area_supervisor','qc','sysadmin'])
);
DROP POLICY IF EXISTS rework_case_events_tenant_scope ON rework_case_events;
CREATE POLICY rework_case_events_tenant_scope ON rework_case_events
FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
    OR fiberos_has_any_role(ARRAY['exec','ops_manager','area_supervisor','qc','sysadmin'])
);


-- All sensitive state changes are performed through SECURITY DEFINER functions.
-- Direct event insertion and direct Rework mutation are denied by RLS so a
-- database-connected client cannot manufacture a plausible audit trail.
CREATE OR REPLACE FUNCTION fiberos_start_payment_cycle(
    p_invoice_id uuid,
    p_evidence_reference text DEFAULT NULL
) RETURNS TABLE(id uuid, invoice_id uuid, state text, actor_id uuid, occurred_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER set search_path = pg_catalog, public, auth
AS $$
DECLARE tid uuid; role_name text; c record;
BEGIN
  SELECT up.tenant_id INTO tid FROM user_preferences up WHERE up.user_id = auth.uid() LIMIT 1;
  role_name := auth.jwt()->'app_metadata'->>'role';
  IF tid IS NULL OR role_name IS NULL OR role_name <> ALL(ARRAY['cfo','exec','ops_manager','sysadmin']) THEN
    RAISE EXCEPTION 'PAYMENT_AUTHORITY_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  SELECT i.id INTO c FROM invoices i WHERE i.id=p_invoice_id AND i.tenant_id=tid FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF EXISTS (SELECT 1 FROM payment_cycles pc WHERE pc.invoice_id=p_invoice_id FOR UPDATE) THEN
    RAISE EXCEPTION 'PAYMENT_CYCLE_ALREADY_EXISTS' USING ERRCODE='23505';
  END IF;
  RETURN QUERY INSERT INTO payment_cycles(tenant_id,invoice_id,state,actor_id)
    VALUES(tid,p_invoice_id,'submitted',auth.uid())
    RETURNING payment_cycles.id,payment_cycles.invoice_id,payment_cycles.state,payment_cycles.actor_id,payment_cycles.occurred_at;
  SELECT pc.id INTO c FROM payment_cycles pc WHERE pc.invoice_id=p_invoice_id;
  INSERT INTO payment_cycle_events(tenant_id,payment_cycle_id,to_state,actor_id,evidence_reference)
    VALUES(tid,c.id,'submitted',auth.uid(),p_evidence_reference);
  UPDATE invoices SET status='issued', updated_at=now() WHERE id=p_invoice_id AND status='draft';
END; $$;

CREATE OR REPLACE FUNCTION fiberos_transition_payment_cycle(
    p_cycle_id uuid,
    p_to_state text,
    p_rejection_reason text DEFAULT NULL,
    p_evidence_reference text DEFAULT NULL
) RETURNS TABLE(id uuid, invoice_id uuid, from_state text, to_state text)
LANGUAGE plpgsql SECURITY DEFINER set search_path = pg_catalog, public, auth
AS $$
DECLARE tid uuid; role_name text; c record; new_invoice_status text;
BEGIN
  SELECT up.tenant_id INTO tid FROM user_preferences up WHERE up.user_id = auth.uid() LIMIT 1;
  role_name := auth.jwt()->'app_metadata'->>'role';
  IF tid IS NULL OR role_name IS NULL OR role_name <> ALL(ARRAY['cfo','exec','ops_manager','sysadmin']) THEN
    RAISE EXCEPTION 'PAYMENT_AUTHORITY_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  SELECT pc.id,pc.invoice_id,pc.state INTO c FROM payment_cycles pc
    WHERE pc.id=p_cycle_id AND pc.tenant_id=tid FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'PAYMENT_CYCLE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF NOT ((c.state='submitted' AND p_to_state IN ('approved','rejected')) OR (c.state='approved' AND p_to_state='paid')) THEN
    RAISE EXCEPTION 'PAYMENT_TRANSITION_FORBIDDEN' USING ERRCODE='P0001';
  END IF;
  IF p_to_state='rejected' AND NULLIF(trim(coalesce(p_rejection_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'REJECTION_REASON_REQUIRED' USING ERRCODE='22023';
  END IF;
  IF p_to_state='paid' AND NULLIF(trim(coalesce(p_evidence_reference,'')),'') IS NULL THEN
    RAISE EXCEPTION 'EVIDENCE_REFERENCE_REQUIRED' USING ERRCODE='22023';
  END IF;
  UPDATE payment_cycles SET state=p_to_state,rejection_reason=CASE WHEN p_to_state='rejected' THEN p_rejection_reason ELSE rejection_reason END,
    actor_id=auth.uid(),occurred_at=now() WHERE id=p_cycle_id;
  INSERT INTO payment_cycle_events(tenant_id,payment_cycle_id,from_state,to_state,actor_id,evidence_reference)
    VALUES(tid,p_cycle_id,c.state,p_to_state,auth.uid(),p_evidence_reference);
  new_invoice_status := CASE WHEN p_to_state='paid' THEN 'paid' WHEN p_to_state='rejected' THEN 'void' ELSE NULL END;
  IF new_invoice_status IS NOT NULL THEN UPDATE invoices SET status=new_invoice_status,updated_at=now() WHERE id=c.invoice_id AND tenant_id=tid; END IF;
  RETURN QUERY SELECT c.id,c.invoice_id,c.state,p_to_state;
END; $$;

CREATE OR REPLACE FUNCTION fiberos_open_rework_case(
    p_case_id text,
    p_ticket_id uuid,
    p_root_cause_category text,
    p_evidence_reference text
) RETURNS TABLE(id uuid, case_id text, ticket_id uuid, root_cause_category text, reported_by uuid, evidence_reference text, status text, opened_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER set search_path = pg_catalog, public, auth
AS $$
DECLARE tid uuid; role_name text; r record;
BEGIN
  SELECT up.tenant_id INTO tid FROM user_preferences up WHERE up.user_id=auth.uid() LIMIT 1;
  role_name := auth.jwt()->'app_metadata'->>'role';
  IF tid IS NULL OR role_name IS NULL OR role_name <> ALL(ARRAY['qc','ops_manager','area_supervisor','exec','sysadmin']) THEN
    RAISE EXCEPTION 'REWORK_AUTHORITY_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF NULLIF(trim(p_case_id),'') IS NULL OR NULLIF(trim(p_root_cause_category),'') IS NULL OR NULLIF(trim(p_evidence_reference),'') IS NULL THEN
    RAISE EXCEPTION 'REWORK_REQUIRED_FIELDS' USING ERRCODE='22023';
  END IF;
  IF p_ticket_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.id=p_ticket_id AND t.tenant_id=tid) THEN
    RAISE EXCEPTION 'TICKET_NOT_FOUND_IN_TENANT' USING ERRCODE='P0002';
  END IF;
  RETURN QUERY INSERT INTO rework_cases(tenant_id,case_id,ticket_id,root_cause_category,reported_by,evidence_reference)
    VALUES(tid,p_case_id,p_ticket_id,p_root_cause_category,auth.uid(),p_evidence_reference)
    RETURNING rework_cases.id,rework_cases.case_id,rework_cases.ticket_id,rework_cases.root_cause_category,rework_cases.reported_by,rework_cases.evidence_reference,rework_cases.status,rework_cases.opened_at;
  SELECT rc.id INTO r FROM rework_cases rc WHERE rc.tenant_id=tid AND rc.case_id=p_case_id;
  INSERT INTO rework_case_events(tenant_id,rework_case_id,event_type,actor_id,evidence_reference)
    VALUES(tid,r.id,'opened',auth.uid(),p_evidence_reference);
END; $$;

CREATE OR REPLACE FUNCTION fiberos_close_rework_case(
    p_case_id text,
    p_evidence_reference text,
    p_resolution_action text
) RETURNS TABLE(case_id text, status text, closed_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER set search_path = pg_catalog, public, auth
AS $$
DECLARE tid uuid; role_name text; r record;
BEGIN
  SELECT up.tenant_id INTO tid FROM user_preferences up WHERE up.user_id=auth.uid() LIMIT 1;
  role_name := auth.jwt()->'app_metadata'->>'role';
  IF tid IS NULL OR role_name IS NULL OR role_name <> ALL(ARRAY['qc','ops_manager','area_supervisor','exec','sysadmin']) THEN
    RAISE EXCEPTION 'REWORK_AUTHORITY_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF NULLIF(trim(p_evidence_reference),'') IS NULL OR NULLIF(trim(p_resolution_action),'') IS NULL THEN
    RAISE EXCEPTION 'REWORK_CLOSE_REQUIRED_FIELDS' USING ERRCODE='22023';
  END IF;
  SELECT rc.id INTO r FROM rework_cases rc WHERE rc.case_id=p_case_id AND rc.tenant_id=tid AND rc.status='open' FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'OPEN_REWORK_CASE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  UPDATE rework_cases SET status='closed',resolution_action=p_resolution_action,closed_at=now() WHERE id=r.id;
  INSERT INTO rework_case_events(tenant_id,rework_case_id,event_type,actor_id,evidence_reference,resolution_action)
    VALUES(tid,r.id,'closed',auth.uid(),p_evidence_reference,p_resolution_action);
  RETURN QUERY SELECT p_case_id,'closed',now();
END; $$;

REVOKE ALL ON FUNCTION fiberos_start_payment_cycle(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION fiberos_transition_payment_cycle(uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION fiberos_open_rework_case(text,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION fiberos_close_rework_case(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fiberos_start_payment_cycle(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION fiberos_transition_payment_cycle(uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION fiberos_open_rework_case(text,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION fiberos_close_rework_case(text,text,text) TO authenticated;

COMMIT;
