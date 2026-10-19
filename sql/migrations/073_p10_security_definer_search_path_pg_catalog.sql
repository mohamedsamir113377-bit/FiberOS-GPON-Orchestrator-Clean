-- FiberOS R14.1 Pass10 — SECURITY DEFINER search_path correction
-- Pins pg_catalog FIRST for known public SECURITY DEFINER functions.
-- Replaces the insufficient R8 setting of "public, auth, pg_temp".
-- Does NOT claim PostgreSQL runtime proof.
-- productionClaim: PROHIBITED
-- PRODUCTION_HOLD remains true until live gates pass.

BEGIN;

-- Core session / authority
ALTER FUNCTION public.fiberos_get_user_locale()
  SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.fiberos_session_tenant_id()
  SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.fiberos_enterprise_tenant_ok(uuid)
  SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.fiberos_transition_ticket(uuid, text)
  SET search_path = pg_catalog, public, auth, pg_temp;

-- Ledger / audit
ALTER FUNCTION public.fiberos_append_hash_ledger(char(64), char(64), bigint, text, text, jsonb)
  SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.fiberos_audit_append(uuid, uuid, text, text, text, uuid, char(64))
  SET search_path = pg_catalog, public, auth, pg_temp;

-- Operational intelligence
ALTER FUNCTION public.fiberos_start_payment_cycle(uuid, text)
  SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.fiberos_transition_payment_cycle(uuid, text, text, text)
  SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.fiberos_open_rework_case(text, uuid, text, text)
  SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.fiberos_close_rework_case(text, text, text)
  SET search_path = pg_catalog, public, auth, pg_temp;

-- Firewall triggers / helpers
ALTER FUNCTION public.fiberos_rework_ticket_firewall(uuid, uuid)
  SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.fiberos_rework_case_firewall_trigger()
  SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.fiberos_payment_cycle_firewall_trigger()
  SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.fiberos_payment_cycle_event_firewall_trigger()
  SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.fiberos_rework_event_firewall_trigger()
  SET search_path = pg_catalog, public, auth, pg_temp;

-- Domain guards
ALTER FUNCTION public.fiberos_enterprise_position_guard()
  SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.fiberos_ftth_state_guard()
  SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.fiberos_contractor_chain_guard()
  SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.fiberos_activation_guard()
  SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.fiberos_measurement_approval_guard()
  SET search_path = pg_catalog, public, auth, pg_temp;

-- Fail-closed inventory: any remaining public SECURITY DEFINER without pg_catalog-first
-- must be corrected by operator after reviewing pg_proc (runtime). Static pack cannot
-- ALTER unknown signatures safely.

COMMIT;
