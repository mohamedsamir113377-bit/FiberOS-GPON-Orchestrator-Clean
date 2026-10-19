-- 091_payment_authority_force_rls.sql
-- FiberOS R14.1 — payment authority compatibility for FORCE RLS.
--
-- 090 made the canonical tenant-sensitive inventory fully FORCE RLS. The
-- payment-cycle tables were already forced by 058, but their SECURITY DEFINER
-- authority functions were created for fiberos_owner without owner-specific
-- RLS policies. Under FORCE RLS, that made the trusted payment functions
-- unable to read/update their own tenant-scoped rows or the referenced invoice.
--
-- This migration restores the intended execution path without weakening FORCE
-- RLS, and also prevents a payment cycle from being started for an invoice
-- that is already void/paid.

BEGIN;

ALTER TABLE payment_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_cycles FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_cycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_cycle_events FORCE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;

-- SECURITY DEFINER payment authority executes as fiberos_owner. These policies
-- are tenant-scoped to the same trusted session tenant derived from auth.uid().
-- No DELETE policy is created; destructive mutation remains denied by RLS.
DROP POLICY IF EXISTS payment_cycles_owner_select ON payment_cycles;
CREATE POLICY payment_cycles_owner_select ON payment_cycles
FOR SELECT TO fiberos_owner
USING (tenant_id = fiberos_session_tenant_id());

DROP POLICY IF EXISTS payment_cycles_owner_insert ON payment_cycles;
CREATE POLICY payment_cycles_owner_insert ON payment_cycles
FOR INSERT TO fiberos_owner
WITH CHECK (
  tenant_id = fiberos_session_tenant_id()
  AND state = 'submitted'
  AND actor_id = auth.uid()
);

DROP POLICY IF EXISTS payment_cycles_owner_update ON payment_cycles;
CREATE POLICY payment_cycles_owner_update ON payment_cycles
FOR UPDATE TO fiberos_owner
USING (tenant_id = fiberos_session_tenant_id())
WITH CHECK (tenant_id = fiberos_session_tenant_id());

DROP POLICY IF EXISTS payment_cycle_events_owner_select ON payment_cycle_events;
CREATE POLICY payment_cycle_events_owner_select ON payment_cycle_events
FOR SELECT TO fiberos_owner
USING (tenant_id = fiberos_session_tenant_id());

DROP POLICY IF EXISTS payment_cycle_events_owner_insert ON payment_cycle_events;
CREATE POLICY payment_cycle_events_owner_insert ON payment_cycle_events
FOR INSERT TO fiberos_owner
WITH CHECK (
  tenant_id = fiberos_session_tenant_id()
  AND actor_id = auth.uid()
);

DROP POLICY IF EXISTS invoices_owner_select ON invoices;
CREATE POLICY invoices_owner_select ON invoices
FOR SELECT TO fiberos_owner
USING (tenant_id = fiberos_session_tenant_id());

DROP POLICY IF EXISTS invoices_owner_update ON invoices;
CREATE POLICY invoices_owner_update ON invoices
FOR UPDATE TO fiberos_owner
USING (tenant_id = fiberos_session_tenant_id())
WITH CHECK (tenant_id = fiberos_session_tenant_id());

CREATE OR REPLACE FUNCTION fiberos_start_payment_cycle(
  p_invoice_id uuid,
  p_evidence_reference text DEFAULT NULL
) RETURNS TABLE(id uuid, invoice_id uuid, state text, actor_id uuid, occurred_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  tid uuid;
  role_name text;
  invoice_status text;
  c record;
BEGIN
  SELECT up.tenant_id
    INTO tid
    FROM user_preferences up
   WHERE up.user_id = auth.uid()
   LIMIT 1;

  role_name := auth.jwt()->'app_metadata'->>'role';

  IF tid IS NULL
     OR role_name IS NULL
     OR role_name <> ALL(ARRAY['cfo','exec','ops_manager','sysadmin']) THEN
    RAISE EXCEPTION 'PAYMENT_AUTHORITY_FORBIDDEN' USING ERRCODE='42501';
  END IF;

  SELECT i.status
    INTO invoice_status
    FROM invoices i
   WHERE i.id = p_invoice_id
     AND i.tenant_id = tid
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE='P0002';
  END IF;

  IF invoice_status NOT IN ('draft','issued','partially_paid','overdue') THEN
    RAISE EXCEPTION 'PAYMENT_INVOICE_NOT_PAYABLE' USING ERRCODE='P0001';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM payment_cycles pc
     WHERE pc.invoice_id = p_invoice_id
     FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'PAYMENT_CYCLE_ALREADY_EXISTS' USING ERRCODE='23505';
  END IF;

  RETURN QUERY
  INSERT INTO payment_cycles(tenant_id, invoice_id, state, actor_id)
  VALUES(tid, p_invoice_id, 'submitted', auth.uid())
  RETURNING payment_cycles.id,
            payment_cycles.invoice_id,
            payment_cycles.state,
            payment_cycles.actor_id,
            payment_cycles.occurred_at;

  SELECT pc.id
    INTO c
    FROM payment_cycles pc
   WHERE pc.invoice_id = p_invoice_id
     AND pc.tenant_id = tid
   FOR UPDATE;

  INSERT INTO payment_cycle_events(
    tenant_id, payment_cycle_id, to_state, actor_id, evidence_reference
  )
  VALUES(tid, c.id, 'submitted', auth.uid(), p_evidence_reference);

  UPDATE invoices
     SET status = 'issued',
         updated_at = now()
   WHERE id = p_invoice_id
     AND tenant_id = tid
     AND status = 'draft';
END;
$$;

CREATE OR REPLACE FUNCTION fiberos_transition_payment_cycle(
  p_cycle_id uuid,
  p_to_state text,
  p_rejection_reason text DEFAULT NULL,
  p_evidence_reference text DEFAULT NULL
) RETURNS TABLE(id uuid, invoice_id uuid, from_state text, to_state text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  tid uuid;
  role_name text;
  c record;
  invoice_status text;
  new_invoice_status text;
BEGIN
  SELECT up.tenant_id
    INTO tid
    FROM user_preferences up
   WHERE up.user_id = auth.uid()
   LIMIT 1;

  role_name := auth.jwt()->'app_metadata'->>'role';

  IF tid IS NULL
     OR role_name IS NULL
     OR role_name <> ALL(ARRAY['cfo','exec','ops_manager','sysadmin']) THEN
    RAISE EXCEPTION 'PAYMENT_AUTHORITY_FORBIDDEN' USING ERRCODE='42501';
  END IF;

  SELECT pc.id, pc.invoice_id, pc.state
    INTO c
    FROM payment_cycles pc
   WHERE pc.id = p_cycle_id
     AND pc.tenant_id = tid
   FOR UPDATE;

  IF c.id IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_CYCLE_NOT_FOUND' USING ERRCODE='P0002';
  END IF;

  IF p_to_state IS NULL OR p_to_state NOT IN ('approved','rejected','paid') THEN
    RAISE EXCEPTION 'PAYMENT_TRANSITION_INPUT_INVALID' USING ERRCODE='22023';
  END IF;

  IF NOT (
    (c.state = 'submitted' AND p_to_state IN ('approved','rejected'))
    OR (c.state = 'approved' AND p_to_state = 'paid')
  ) THEN
    RAISE EXCEPTION 'PAYMENT_TRANSITION_FORBIDDEN' USING ERRCODE='P0001';
  END IF;

  SELECT i.status
    INTO invoice_status
    FROM invoices i
   WHERE i.id = c.invoice_id
     AND i.tenant_id = tid
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE='P0002';
  END IF;

  IF p_to_state = 'rejected'
     AND invoice_status IN ('paid','void') THEN
    RAISE EXCEPTION 'PAYMENT_INVOICE_STATE_CONFLICT' USING ERRCODE='P0001';
  END IF;

  IF p_to_state = 'approved'
     AND invoice_status NOT IN ('issued','partially_paid','overdue') THEN
    RAISE EXCEPTION 'PAYMENT_INVOICE_NOT_APPROVABLE' USING ERRCODE='P0001';
  END IF;

  IF p_to_state = 'paid'
     AND invoice_status NOT IN ('issued','partially_paid','overdue') THEN
    RAISE EXCEPTION 'PAYMENT_INVOICE_NOT_PAYABLE' USING ERRCODE='P0001';
  END IF;

  IF p_to_state = 'rejected'
     AND NULLIF(trim(coalesce(p_rejection_reason,'')), '') IS NULL THEN
    RAISE EXCEPTION 'REJECTION_REASON_REQUIRED' USING ERRCODE='22023';
  END IF;

  IF p_to_state = 'paid'
     AND NULLIF(trim(coalesce(p_evidence_reference,'')), '') IS NULL THEN
    RAISE EXCEPTION 'EVIDENCE_REFERENCE_REQUIRED' USING ERRCODE='22023';
  END IF;

  UPDATE payment_cycles
     SET state = p_to_state,
         rejection_reason = CASE
           WHEN p_to_state = 'rejected' THEN p_rejection_reason
           ELSE rejection_reason
         END,
         actor_id = auth.uid(),
         occurred_at = now()
   WHERE id = p_cycle_id
     AND tenant_id = tid;

  INSERT INTO payment_cycle_events(
    tenant_id, payment_cycle_id, from_state, to_state, actor_id, evidence_reference
  )
  VALUES(tid, p_cycle_id, c.state, p_to_state, auth.uid(), p_evidence_reference);

  new_invoice_status := CASE
    WHEN p_to_state = 'paid' THEN 'paid'
    WHEN p_to_state = 'rejected' THEN 'void'
    ELSE NULL
  END;

  IF new_invoice_status IS NOT NULL THEN
    UPDATE invoices
       SET status = new_invoice_status,
           updated_at = now()
     WHERE id = c.invoice_id
       AND tenant_id = tid;
  END IF;

  RETURN QUERY SELECT c.id, c.invoice_id, c.state, p_to_state;
END;
$$;

REVOKE ALL ON FUNCTION fiberos_start_payment_cycle(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fiberos_start_payment_cycle(uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION fiberos_transition_payment_cycle(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fiberos_transition_payment_cycle(uuid,text,text,text) TO authenticated;

COMMIT;
