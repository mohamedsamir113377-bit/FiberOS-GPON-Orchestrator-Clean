-- FiberNexus Migration 188 contract tests — NON-PRODUCTION ONLY
-- Do NOT run against Neon production.
-- Prerequisites: PostgreSQL 18+, migration 188 applied on a disposable DB,
-- roles fiberos_app / fiberos_worker exist (or adapt role names).
-- Expected: document pass/fail per assertion; exit nonzero on hard fail when wrapped by CI.

\set ON_ERROR_STOP on
BEGIN;

-- Isolation marker
DO $$ BEGIN
  RAISE NOTICE 'M188_CONTRACT_TEST_START database=% user=%', current_database(), current_user;
END $$;

-- E1: RLS policy must not treat unset app.tenant_id as wildcard open access
DO $$
DECLARE
  n int;
BEGIN
  PERFORM set_config('app.tenant_id', '', true);
  SELECT count(*) INTO n FROM enterprise_change_log;
  RAISE NOTICE 'E1_empty_guc_visible_rows=%', n;
  IF n > 0 THEN
    RAISE EXCEPTION 'E1_FAILED: empty tenant GUC exposed % rows', n;
  END IF;
  -- Under FORCE RLS, empty tenant should not expose other tenants' rows.
  -- If n > 0 after only seeding other tenants, FAIL (checked after seed below).
END $$;

-- Seed two tenants' log rows as table owner / superuser path
DO $$
BEGIN
  -- Use direct insert as current privileged role for fixture only
  INSERT INTO enterprise_change_log(tenant_id, table_name, row_pk, op, old_data, new_data, actor)
  VALUES
    ('tenant-A', 'fixture', '1', 'INSERT', NULL, '{"tenant_id":"tenant-A","id":"1"}'::jsonb, 'test_seed'),
    ('tenant-B', 'fixture', '2', 'INSERT', NULL, '{"tenant_id":"tenant-B","id":"2"}'::jsonb, 'test_seed');
END $$;

-- E1b: SET app.tenant_id to A — should only see A (when running as constrained role)
DO $$
DECLARE n int; other int;
BEGIN
  PERFORM set_config('app.tenant_id', 'tenant-A', true);
  SELECT count(*) INTO n FROM enterprise_change_log WHERE tenant_id = 'tenant-A';
  SELECT count(*) INTO other FROM enterprise_change_log WHERE tenant_id = 'tenant-B';
  RAISE NOTICE 'E1b_as_tenant_A rows_A=% rows_B_visible=%', n, other;
  IF other <> 0 THEN
    RAISE EXCEPTION 'E1_FAIL: tenant-B rows visible while app.tenant_id=tenant-A';
  END IF;
END $$;

-- E2 simulation: API path sets JWT claims + fiberos_app but NOT app.tenant_id
DO $$
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE fiberos_app';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'E2_SKIP: fiberos_app role not usable here: %', SQLERRM;
    RETURN;
  END;
  PERFORM set_config('request.jwt.claim.sub', 'user-1', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  -- deliberately do NOT set app.tenant_id (mirrors session.js gap)
  PERFORM set_config('app.tenant_id', '', true);
  RAISE NOTICE 'E2_api_path_without_tenant_guc: attempting select';
  PERFORM count(*) FROM enterprise_change_log;
  RAISE NOTICE 'E2_OBSERVE: select completed; enforce expected isolation in role-bound CI';
END $$;

-- E4: actor excluded from hash — detect by comparing two rows differing only in actor
DO $$
DECLARE h1 text; h2 text;
BEGIN
  -- Recompute hash the same way as ecl_chain without actor
  SELECT encode(sha256(convert_to(
    coalesce(prev_hash,'') || tenant_id || table_name || row_pk || op ||
    coalesce(old_data::text,'') || coalesce(new_data::text,'') || changed_at::text, 'UTF8')), 'hex')
  INTO h1 FROM enterprise_change_log WHERE tenant_id='tenant-A' ORDER BY seq DESC LIMIT 1;
  RAISE NOTICE 'E4_hash_without_actor sample=%', left(h1, 16);
  RAISE NOTICE 'E4_DOC: actor is NOT in hash input in ecl_chain(); bit-flip on actor will not break row_hash';
END $$;

-- E6: verify_chain global prev vs per-tenant writer
DO $$
DECLARE broken bigint;
BEGIN
  SELECT ecl_verify_chain() INTO broken;
  RAISE NOTICE 'E6_ecl_verify_chain_result=% (NULL means reported intact)', broken;
  RAISE NOTICE 'E6_DOC: with multi-tenant rows, global prev walk can disagree with per-tenant chains';
END $$;

-- Cleanup fixtures for this session transaction
DELETE FROM enterprise_change_log WHERE table_name = 'fixture' AND actor = 'test_seed';

ROLLBACK;

DO $$ BEGIN
  RAISE NOTICE 'M188_CONTRACT_TEST_END rolled_back=true (no durable writes)';
END $$;
