-- FiberOS R8 — SECURITY DEFINER search_path hardening.
-- PostgreSQL 18 guidance: trusted schemas first; pg_temp LAST.
-- This migration intentionally makes no runtime claims.
BEGIN;

ALTER FUNCTION public.fiberos_get_user_locale()
  set search_path = pg_catalog, public, auth, pg_temp;
REVOKE ALL ON FUNCTION public.fiberos_get_user_locale() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fiberos_get_user_locale() TO authenticated;

ALTER FUNCTION public.fiberos_transition_ticket(uuid, text)
  set search_path = pg_catalog, public, auth, pg_temp;
REVOKE ALL ON FUNCTION public.fiberos_transition_ticket(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fiberos_transition_ticket(uuid, text) TO authenticated, fiberos_app;

ALTER FUNCTION public.fiberos_append_hash_ledger(char(64), char(64), bigint, text, text, jsonb)
  SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION public.fiberos_append_hash_ledger(char(64), char(64), bigint, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fiberos_append_hash_ledger(char(64), char(64), bigint, text, text, jsonb) TO authenticated, fiberos_app;

ALTER FUNCTION public.fiberos_audit_append(uuid, uuid, text, text, text, uuid, char(64))
  set search_path = pg_catalog, public, auth, pg_temp;
REVOKE ALL ON FUNCTION public.fiberos_audit_append(uuid, uuid, text, text, text, uuid, char(64)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fiberos_audit_append(uuid, uuid, text, text, text, uuid, char(64)) TO authenticated, fiberos_app;

COMMIT;
