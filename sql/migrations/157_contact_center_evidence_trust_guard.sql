-- 157_contact_center_evidence_trust_guard.sql
-- Client-submitted message records may carry claims and references, but cannot
-- self-promote their trust class. Verified evidence belongs in the evidence
-- subsystem, not in an immutable conversation-message insert.
BEGIN;

CREATE OR REPLACE FUNCTION public.fiberos_cc_message_evidence_class_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.evidence_class IS DISTINCT FROM 'declared' THEN
    RAISE EXCEPTION 'CC_MESSAGE_EVIDENCE_CLASS_SERVER_MANAGED'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cc_message_evidence_class_guard
  ON public.contact_center_conversation_messages;
CREATE TRIGGER trg_cc_message_evidence_class_guard
  BEFORE INSERT ON public.contact_center_conversation_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_cc_message_evidence_class_guard();

COMMENT ON FUNCTION public.fiberos_cc_message_evidence_class_guard() IS
  'Rejects client/application message inserts that self-assert observed, measured, derived or unverified evidence classes; promotion must occur in the evidence subsystem.';
COMMENT ON COLUMN public.contact_center_conversation_messages.evidence_class IS
  'Message-origin trust class. API and database insert boundary permit declared only; validated evidence is represented and promoted by the evidence subsystem.';

REVOKE ALL ON FUNCTION public.fiberos_cc_message_evidence_class_guard()
  FROM PUBLIC, anon, authenticated;

COMMIT;
