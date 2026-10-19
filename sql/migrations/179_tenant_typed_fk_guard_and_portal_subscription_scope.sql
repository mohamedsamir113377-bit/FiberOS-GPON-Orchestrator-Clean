-- 179_tenant_typed_fk_guard_and_portal_subscription_scope.sql
-- Preserve the native type of FK values in the generic tenant guard, and make
-- portal subscription-event ownership part of the database FK itself.
BEGIN;

CREATE OR REPLACE FUNCTION public.fiberos_guard_fk_tenant_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  parent_table text := TG_ARGV[0];
  parent_col   text := TG_ARGV[1];
  child_col    text := TG_ARGV[2];
  ref_tenant   uuid;
  child_is_null boolean;
  sql          text;
BEGIN
  IF current_setting('session_replication_role', true) = 'replica' THEN
    RETURN NEW;
  END IF;

  -- Preserve NULL semantics while comparing non-NULL FK values in their native SQL type.
  EXECUTE format('SELECT ($1).%I IS NULL', child_col) INTO child_is_null USING NEW;
  IF child_is_null THEN
    RETURN NEW;
  END IF;

  -- This supports UUID, bigint, integer, and other FK-compatible key types.
  sql := format(
    'SELECT tenant_id FROM public.%I WHERE %I = ($1).%I LIMIT 1',
    parent_table, parent_col, child_col
  );
  EXECUTE sql INTO ref_tenant USING NEW;

  -- A missing or RLS-hidden parent is not evidence of same-tenant ownership.
  IF ref_tenant IS NULL THEN
    RAISE EXCEPTION 'TENANT_REFERENCE_MISSING_OR_NOT_VISIBLE_%_%',
      upper(TG_TABLE_NAME), upper(child_col)
      USING ERRCODE = '42501';
  END IF;

  IF ref_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH_%_%', upper(TG_TABLE_NAME), upper(child_col)
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fiberos_guard_fk_tenant_match() IS
  'Generic cross-tenant FK guard using native FK value types. TG_ARGV: parent_table, parent_pk_col, child_fk_col.';

-- PostgreSQL requires a unique key over the exact referenced column set.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.portal_subscriptions'::regclass
      AND conname = 'portal_subscriptions_tenant_id_id_key'
  ) THEN
    ALTER TABLE public.portal_subscriptions
      ADD CONSTRAINT portal_subscriptions_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END;
$$;

ALTER TABLE public.portal_subscription_events
  DROP CONSTRAINT IF EXISTS portal_subscription_events_subscription_id_fkey;
ALTER TABLE public.portal_subscription_events
  DROP CONSTRAINT IF EXISTS portal_subscription_events_tenant_subscription_fkey;
ALTER TABLE public.portal_subscription_events
  ADD CONSTRAINT portal_subscription_events_tenant_subscription_fkey
  FOREIGN KEY (tenant_id, subscription_id)
  REFERENCES public.portal_subscriptions (tenant_id, id)
  ON DELETE RESTRICT;

COMMIT;
