'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const migration120 = fs.readFileSync(
  path.join(ROOT, 'sql/migrations/120_operational_cycle_execution_closure.sql'),
  'utf8'
);
const migration122 = fs.readFileSync(
  path.join(ROOT, 'sql/migrations/122_sync_ingest_execute_privilege_closure.sql'),
  'utf8'
);

test('migration 122 closes direct sync-ingest EXECUTE exposure', () => {
  assert.match(
    migration120,
    /CREATE OR REPLACE FUNCTION public\.fiberos_ingest_sync_batch\(p_ops jsonb,p_principal jsonb\)/i
  );
  assert.match(
    migration120,
    /identity and role are[\s\S]*derived from the verified database session and never from caller JSON/i,
    'the sync executor must document that identity/role come from the verified database session'
  );
  assert.match(
    migration120,
    /auth\.uid\(\)[\s\S]*auth\.jwt\(\)->'app_metadata'->>'role'/i,
    'the sync executor must derive the persisted actor and role from the verified session, not caller JSON'
  );
  assert.doesNotMatch(
    migration120,
    /p_principal\s*->>\s*'role'/i,
    'the sync executor must not read the application role from caller-supplied JSON'
  );
  assert.match(
    migration120,
    /actor_sub[\s\S]*auth\.uid\(\)::text/i,
    'the sync executor must persist the session actor as actor_sub'
  );
  assert.match(
    migration122,
    /REVOKE ALL ON FUNCTION public\.fiberos_ingest_sync_batch\(jsonb, jsonb\)[\s\S]*FROM PUBLIC, anon, authenticated, fiberos_runtime, fiberos_worker, fiberos_app/i
  );
  assert.match(
    migration122,
    /GRANT EXECUTE ON FUNCTION public\.fiberos_ingest_sync_batch\(jsonb, jsonb\)[\s\S]*TO fiberos_app/i
  );
});
