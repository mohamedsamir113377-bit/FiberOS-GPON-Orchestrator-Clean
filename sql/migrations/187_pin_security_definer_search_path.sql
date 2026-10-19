-- 187_pin_security_definer_search_path.sql
-- Pin six SECURITY DEFINER tenant-bound trigger functions against pg_temp name shadowing.
-- Safe to reapply: SET search_path is idempotent; assertions fail closed if catalog state differs.
BEGIN;
DO $fiberos$
DECLARE v_functions integer;
BEGIN
 SELECT count(*) INTO v_functions FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname=ANY(ARRAY['fiberos_network_port_card_tenant_guard','fiberos_notify_technician_position','fiberos_position_set_tenant','fiberos_splice_tenant_guard','fiberos_technician_role_tenant_guard','fiberos_ticket_worker_tenant_guard'])
 AND p.prosecdef=true AND pg_catalog.pg_get_userbyid(p.proowner)='fiberos_owner';
 IF v_functions<>6 THEN RAISE EXCEPTION 'FIBEROS_SEARCH_PATH_FUNCTION_INVENTORY_INVALID:%',v_functions; END IF;
END $fiberos$;
ALTER FUNCTION public.fiberos_network_port_card_tenant_guard() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.fiberos_notify_technician_position() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.fiberos_position_set_tenant() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.fiberos_splice_tenant_guard() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.fiberos_technician_role_tenant_guard() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.fiberos_ticket_worker_tenant_guard() SET search_path = pg_catalog, public, pg_temp;
DO $fiberos$
DECLARE v_configured integer; v_enabled_triggers integer;
BEGIN
 SELECT count(*) INTO v_configured FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname=ANY(ARRAY['fiberos_network_port_card_tenant_guard','fiberos_notify_technician_position','fiberos_position_set_tenant','fiberos_splice_tenant_guard','fiberos_technician_role_tenant_guard','fiberos_ticket_worker_tenant_guard'])
 AND p.prosecdef=true AND p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']::text[];
 SELECT count(*) INTO v_enabled_triggers FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname=ANY(ARRAY['fiberos_network_port_card_tenant_guard','fiberos_notify_technician_position','fiberos_position_set_tenant','fiberos_splice_tenant_guard','fiberos_technician_role_tenant_guard','fiberos_ticket_worker_tenant_guard'])
 AND NOT t.tgisinternal AND t.tgenabled='O';
 IF v_configured<>6 OR v_enabled_triggers<>6 THEN RAISE EXCEPTION 'FIBEROS_SEARCH_PATH_POSTCONDITION_FAILED:configured=% triggers=%',v_configured,v_enabled_triggers; END IF;
END $fiberos$;
COMMIT;
