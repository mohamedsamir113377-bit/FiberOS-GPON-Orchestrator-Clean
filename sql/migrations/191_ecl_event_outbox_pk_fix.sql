-- Migration 191: Fix ECL capture PK for event_outbox_contract.
-- Production defect: trigger called ecl_capture('id') but table PK column is event_id.
BEGIN;

DROP TRIGGER IF EXISTS t_ecl_event_outbox_contract ON public.event_outbox_contract;
SELECT public.ecl_attach_capture('event_outbox_contract', 'event_id');

DO $post$
DECLARE
  def text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO def
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.event_outbox_contract'::regclass
    AND t.tgname = 't_ecl_event_outbox_contract'
    AND NOT t.tgisinternal;
  IF def IS NULL OR position('ecl_capture(''event_id'')' IN def) = 0 THEN
    RAISE EXCEPTION 'FIBERNEXUS_M191_ECL_OUTBOX_PK_POSTCONDITION_FAILED';
  END IF;
END
$post$;

COMMIT;
