-- 093_payment_authority_plpgsql_ambiguity_fix.sql
-- FiberOS R14.1
--
-- Runtime PostgreSQL 18 verification reached the payment authority functions
-- and exposed PL/pgSQL variable/column ambiguity in UPDATE predicates.
-- The return-column variable "id" conflicts with table columns named "id".
-- This migration preserves the function contracts and explicitly qualifies
-- target-table columns instead of changing global/function conflict policy.

BEGIN;

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
   WHERE invoices.id = p_invoice_id
     AND invoices.tenant_id = tid
     AND invoices.status = 'draft';
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
   WHERE payment_cycles.id = p_cycle_id
     AND payment_cycles.tenant_id = tid;

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
     WHERE invoices.id = c.invoice_id
       AND invoices.tenant_id = tid;
  END IF;

  RETURN QUERY SELECT c.id, c.invoice_id, c.state, p_to_state;
END;
$$;


COMMIT;
