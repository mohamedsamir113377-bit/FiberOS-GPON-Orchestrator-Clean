-- FiberOS post-migration runtime grants — cluster administrator/controlled DBA phase.
-- Requires the production migrations to have completed successfully.

DO $$
BEGIN
  IF to_regclass('public.outbox_events') IS NULL THEN
    RAISE EXCEPTION 'OUTBOX_TABLE_REQUIRED_BEFORE_WORKER_GRANTS';
  END IF;
END $$;

-- 015 grants on all public tables can expose the migration ledger.
-- Reassert the ledger's owner/migrator-only ACL in the controlled DBA phase.
REVOKE ALL ON TABLE public.fiberos_migration_history
  FROM PUBLIC, anon, authenticated, fiberos_runtime, fiberos_worker, fiberos_app, fiberos_migrator;
GRANT SELECT ON TABLE public.fiberos_migration_history TO fiberos_migrator;

-- Runtime readiness gets only a compact attestation of the migration ledger.
-- The raw ledger stays readable only to the migration identity; no row-level
-- ledger data or checksum list is exposed to application/runtime callers.
CREATE OR REPLACE FUNCTION public.fiberos_migration_history_attestation()
RETURNS TABLE (
  migration_count bigint,
  latest_migration text,
  ledger_sha256 text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fiberos$
  SELECT
    count(*)::bigint,
    max(migration_name COLLATE "C")::text,
    encode(
      public.digest(
        convert_to(
          coalesce(
            string_agg(
              migration_name || chr(31) || lower(sha256),
              chr(10) ORDER BY migration_name COLLATE "C"
            ),
            ''
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  FROM public.fiberos_migration_history;
$fiberos$;

ALTER FUNCTION public.fiberos_migration_history_attestation() OWNER TO fiberos_owner;
REVOKE ALL ON FUNCTION public.fiberos_migration_history_attestation()
  FROM PUBLIC, anon, authenticated, fiberos_app, fiberos_worker, fiberos_migrator;
GRANT EXECUTE ON FUNCTION public.fiberos_migration_history_attestation() TO fiberos_runtime;
COMMENT ON FUNCTION public.fiberos_migration_history_attestation() IS
  'Returns migration ledger count, head and SHA-256 commitment only. Runtime callers cannot read raw migration ledger rows.';


GRANT USAGE ON SCHEMA public TO fiberos_worker;
GRANT SELECT, UPDATE ON outbox_events TO fiberos_worker;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outbox_worker_select ON outbox_events;
CREATE POLICY outbox_worker_select ON outbox_events
  FOR SELECT TO fiberos_worker
  USING (current_user = 'fiberos_worker');

DROP POLICY IF EXISTS outbox_worker_update ON outbox_events;
CREATE POLICY outbox_worker_update ON outbox_events
  FOR UPDATE TO fiberos_worker
  USING (current_user = 'fiberos_worker')
  WITH CHECK (current_user = 'fiberos_worker');

COMMENT ON ROLE fiberos_owner IS 'FiberOS object owner boundary; NOLOGIN, no runtime use.';
COMMENT ON ROLE fiberos_app IS 'FiberOS constrained DB authority; NOLOGIN, never a superuser.';
COMMENT ON ROLE fiberos_migrator IS 'FiberOS deployment identity; never used by API/worker runtime.';
COMMENT ON ROLE fiberos_runtime IS 'FiberOS API/GIS runtime login; constrained through fiberos_app + RLS.';
COMMENT ON ROLE fiberos_worker IS 'FiberOS outbox worker login; explicit worker-only privileges, no app-role membership.';

-- Signed telco webhook DB authority.
-- The webhook route authenticates the external provider signature in application
-- memory. These SECURITY DEFINER functions then provide the only DB path for
-- provider lookup/replay registration/session creation. fiberos_runtime receives
-- EXECUTE only; it never receives direct table DML. FORCE RLS plus a definer-only
-- transaction marker keeps these functions from becoming general-purpose table
-- access.
ALTER TABLE telco_webhook_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE telco_webhook_replay_guard ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telco_webhook_provider_owner_ingest_select ON telco_webhook_providers;
CREATE POLICY telco_webhook_provider_owner_ingest_select
ON telco_webhook_providers
FOR SELECT TO fiberos_owner
USING (
  current_user = 'fiberos_owner'
  AND current_setting('fiberos.webhook_ingest', true) = 'allowed'
);

DROP POLICY IF EXISTS telco_webhook_replay_owner_ingest_insert ON telco_webhook_replay_guard;
CREATE POLICY telco_webhook_replay_owner_ingest_insert
ON telco_webhook_replay_guard
FOR INSERT TO fiberos_owner
WITH CHECK (
  current_user = 'fiberos_owner'
  AND current_setting('fiberos.webhook_ingest', true) = 'allowed'
);

DROP POLICY IF EXISTS telco_webhook_call_owner_ingest_select ON call_sessions;
CREATE POLICY telco_webhook_call_owner_ingest_select
ON call_sessions
FOR SELECT TO fiberos_owner
USING (
  current_user = 'fiberos_owner'
  AND current_setting('fiberos.webhook_ingest', true) = 'allowed'
);

DROP POLICY IF EXISTS telco_webhook_call_owner_ingest_insert ON call_sessions;
CREATE POLICY telco_webhook_call_owner_ingest_insert
ON call_sessions
FOR INSERT TO fiberos_owner
WITH CHECK (
  current_user = 'fiberos_owner'
  AND current_setting('fiberos.webhook_ingest', true) = 'allowed'
);

DROP POLICY IF EXISTS telco_webhook_call_owner_ingest_update ON call_sessions;
CREATE POLICY telco_webhook_call_owner_ingest_update
ON call_sessions
FOR UPDATE TO fiberos_owner
USING (
  current_user = 'fiberos_owner'
  AND current_setting('fiberos.webhook_ingest', true) = 'allowed'
)
WITH CHECK (
  current_user = 'fiberos_owner'
  AND current_setting('fiberos.webhook_ingest', true) = 'allowed'
);

CREATE OR REPLACE FUNCTION fiberos_webhook_provider_context(p_provider_key text)
RETURNS TABLE(provider_id uuid, tenant_id uuid, signing_secret_ref text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM set_config('fiberos.webhook_ingest', 'allowed', true);

  RETURN QUERY
  SELECT p.id, p.tenant_id, p.signing_secret_ref
  FROM public.telco_webhook_providers AS p
  WHERE p.provider_key = p_provider_key
    AND p.active = true
  LIMIT 1;
END
$$;

ALTER FUNCTION fiberos_webhook_provider_context(text) OWNER TO fiberos_owner;
REVOKE ALL ON FUNCTION fiberos_webhook_provider_context(text) FROM PUBLIC, anon, authenticated, fiberos_app, fiberos_worker;
GRANT EXECUTE ON FUNCTION fiberos_webhook_provider_context(text) TO fiberos_runtime;

CREATE OR REPLACE FUNCTION fiberos_record_telco_webhook(
  p_provider_id uuid,
  p_event_id text,
  p_secret_ref text,
  p_direction text,
  p_external_call_id text,
  p_caller_number text
)
RETURNS TABLE(session_id uuid, ivr_state text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  provider_record record;
  replay_rows integer;
  session_record record;
BEGIN
  PERFORM set_config('fiberos.webhook_ingest', 'allowed', true);

  IF p_provider_id IS NULL OR p_event_id IS NULL OR btrim(p_event_id) = ''
     OR p_secret_ref IS NULL OR btrim(p_secret_ref) = ''
     OR p_external_call_id IS NULL OR btrim(p_external_call_id) = '' THEN
    RAISE EXCEPTION 'TELCO_WEBHOOK_INPUT_REQUIRED';
  END IF;

  SELECT p.id, p.tenant_id, p.provider_key, p.signing_secret_ref, p.active
  INTO provider_record
  FROM public.telco_webhook_providers AS p
  WHERE p.id = p_provider_id
  FOR SHARE;

  IF NOT FOUND OR provider_record.active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TELCO_PROVIDER_CONTEXT_REJECTED';
  END IF;

  IF provider_record.signing_secret_ref IS DISTINCT FROM p_secret_ref THEN
    RAISE EXCEPTION 'TELCO_PROVIDER_SECRET_REFERENCE_CHANGED';
  END IF;

  INSERT INTO public.telco_webhook_replay_guard(provider_id, event_id)
  VALUES (provider_record.id, p_event_id)
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS replay_rows = ROW_COUNT;
  IF replay_rows = 0 THEN
    RAISE EXCEPTION 'TELCO_WEBHOOK_REPLAY';
  END IF;

  INSERT INTO public.call_sessions(
    tenant_id, provider, direction, external_call_id, caller_number, status, ivr_state
  )
  VALUES (
    provider_record.tenant_id,
    provider_record.provider_key,
    p_direction,
    p_external_call_id,
    NULLIF(p_caller_number, ''),
    'ivr',
    'welcome'
  )
  ON CONFLICT (tenant_id, external_call_id) DO UPDATE
  SET caller_number = coalesce(excluded.caller_number, public.call_sessions.caller_number)
  RETURNING id, ivr_state
  INTO session_record;

  RETURN QUERY SELECT session_record.id, session_record.ivr_state;
END
$$;

ALTER FUNCTION fiberos_record_telco_webhook(uuid,text,text,text,text,text) OWNER TO fiberos_owner;
REVOKE ALL ON FUNCTION fiberos_record_telco_webhook(uuid,text,text,text,text,text) FROM PUBLIC, anon, authenticated, fiberos_app, fiberos_worker;
GRANT EXECUTE ON FUNCTION fiberos_record_telco_webhook(uuid,text,text,text,text,text) TO fiberos_runtime;

-- Tenant resolver: assign ownership as superuser (ADMIN_URL). Migration 176
-- only grants column SELECT; OWNER TO cannot run under the migrator role when
-- the function is not already owned by fiberos_owner.
ALTER FUNCTION public.fiberos_current_tenant_id() OWNER TO fiberos_policy_reader;
ALTER FUNCTION public.fiberos_guard_fk_tenant_match() OWNER TO fiberos_policy_reader;
ALTER FUNCTION public.fiberos_guard_composite_fk_tenant_match() OWNER TO fiberos_policy_reader;
REVOKE CREATE ON SCHEMA public FROM fiberos_policy_reader;
REVOKE ALL ON FUNCTION public.fiberos_current_tenant_id() FROM PUBLIC;
-- fiberos_owner must EXECUTE: SECURITY DEFINER helpers (e.g. fiberos_transition_ticket)
-- run as the function owner and call fiberos_current_tenant_id nested.
GRANT EXECUTE ON FUNCTION public.fiberos_current_tenant_id()
  TO fiberos_owner, fiberos_app, fiberos_runtime, fiberos_worker, authenticated, anon;

-- Post-migration hardening: remove temporary policy-reader membership from owner.
-- The SECURITY DEFINER predicate is already owned by fiberos_policy_reader;
-- owner membership was only needed during migration 113 function creation.
REVOKE fiberos_policy_reader FROM fiberos_owner;

