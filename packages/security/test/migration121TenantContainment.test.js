'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const migration117 = fs.readFileSync(
  path.join(ROOT, 'sql/migrations/117_field_operations_integration.sql'),
  'utf8'
);
const migration121 = fs.readFileSync(
  path.join(ROOT, 'sql/migrations/121_tenant_containment_closure.sql'),
  'utf8'
);

const policies = [
  'network_cards_scope',
  'technician_role_assignments_scope',
  'ticket_worker_assignments_scope',
  'splice_records_scope'
];

function policyBody(source, policy) {
  const match = source.match(
    new RegExp('CREATE\\s+POLICY\\s+' + policy + '[\\s\\S]*?\\);', 'i')
  );
  assert.ok(match, policy + ' must exist');
  return match[0];
}

test('migration 121 closes the four migration-117 tenant SELECT regressions', () => {
  for (const policy of policies) {
    const body = policyBody(migration121, policy);
    assert.doesNotMatch(
      body,
      /\bOR\s+fiberos_has_any_role\s*\(/i,
      policy + ' must not contain a role-only SELECT escape'
    );
    assert.match(
      body,
      /(?:\ba\.)?\btenant_id\s+IN\s*\(\s*SELECT\s+tenant_id\s+FROM\s+user_preferences/i,
      policy + ' must remain tenant-membership bound'
    );
  }
});

test('migration 117 remains the auditable regression source and migration 121 is its append-only closure', () => {
  assert.match(migration117, /network_cards_scope[\s\S]*fiberos_has_any_role/i);
  assert.match(migration117, /technician_role_assignments_scope[\s\S]*fiberos_has_any_role/i);
  assert.match(migration117, /ticket_worker_assignments_scope[\s\S]*fiberos_has_any_role/i);
  assert.match(migration117, /splice_records_scope[\s\S]*fiberos_has_any_role/i);
  assert.match(migration121, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(migration121, /DROP POLICY IF EXISTS network_cards_scope/i);
  assert.match(migration121, /DROP POLICY IF EXISTS technician_role_assignments_scope/i);
  assert.match(migration121, /DROP POLICY IF EXISTS ticket_worker_assignments_scope/i);
  assert.match(migration121, /DROP POLICY IF EXISTS splice_records_scope/i);
});
