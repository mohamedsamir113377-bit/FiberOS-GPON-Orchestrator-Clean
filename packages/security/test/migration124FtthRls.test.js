'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const migration = fs.readFileSync(
  path.join(ROOT, 'sql/migrations/124_ftth_audit_tenant_rls_semantics.sql'), 'utf8'
);
const semanticAudit = fs.readFileSync(
  path.join(ROOT, 'scripts/buyer-acceptance/ftth-audit-rls-semantic-audit.js'), 'utf8'
);
const existingRlsAudit = fs.readFileSync(
  path.join(ROOT, 'scripts/buyer-acceptance/live-postgres-rls.js'), 'utf8'
);

test('migration 124 refuses to guess historical command-decision tenant ownership', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS tenant_id uuid/i);
  assert.match(migration, /WHERE tenant_id IS NULL[\s\S]*?RAISE EXCEPTION[\s\S]*?TENANT_BACKFILL_REQUIRED/i);
  assert.match(migration, /FOREIGN KEY \(tenant_id\)\s+REFERENCES public\.tenants\(id\)\s+ON DELETE RESTRICT/i);
  assert.match(migration, /ALTER COLUMN tenant_id SET NOT NULL/i);
});

test('migration 124 keeps both audit tables FORCE-RLS and read-only to authenticated users', () => {
  for (const table of ['ftth_command_decisions', 'ftth_work_state_transitions']) {
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, 'i'));
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} FORCE ROW LEVEL SECURITY`, 'i'));
  }
  assert.match(migration, /ftth_command_decisions_tenant_read[\s\S]*?FOR SELECT TO authenticated[\s\S]*?fiberos_enterprise_tenant_ok\(tenant_id\)/i);
  assert.match(migration, /ftth_work_state_transitions_tenant_read[\s\S]*?FOR SELECT TO authenticated[\s\S]*?FROM public\.ftth_work_packages AS wp[\s\S]*?wp\.id = public\.ftth_work_state_transitions\.work_package_id[\s\S]*?fiberos_enterprise_tenant_ok\(wp\.tenant_id\)/i);
  assert.doesNotMatch(migration, /CREATE POLICY[\s\S]*?FOR (?:ALL|INSERT|UPDATE|DELETE) TO authenticated/i);
  assert.doesNotMatch(migration, /GRANT\s+(?:ALL|INSERT|UPDATE|DELETE)\s+ON\s+(?:TABLE\s+)?public\.ftth_(?:command_decisions|work_state_transitions)/i);
});

test('live semantic audit checks tenant A/B visibility and denies direct writes', () => {
  assert.match(semanticAudit, /tenant A must read its decision and must not read tenant B decision/);
  assert.match(semanticAudit, /parent work package belongs to tenant A/);
  assert.match(semanticAudit, /direct authenticated INSERT must be denied/);
  assert.match(semanticAudit, /\['command decision UPDATE', decisionUpdate\]/);
  assert.match(semanticAudit, /\['command decision DELETE', decisionDelete\]/);
  assert.match(semanticAudit, /assert\.equal\(result\.rowCount, 0/);
  assert.match(semanticAudit, /productionCertification: false/);
});

test('FTTH audit runtime fixtures do not reuse identifiers from the existing RLS audit', () => {
  const ids = semanticAudit.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [];
  assert.ok(ids.length >= 12, 'dedicated tenant, actor, parent, transition, decision, and command fixtures must be defined');
  for (const id of ids) {
    assert.equal(existingRlsAudit.includes(id), false, `FTTH audit fixture ${id} must not collide with the shared RLS audit`);
  }
});
