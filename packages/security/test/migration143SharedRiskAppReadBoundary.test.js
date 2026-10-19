'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const migration = fs.readFileSync(
  path.join(ROOT, 'sql/migrations/143_runtime_shared_risk_app_read_boundary.sql'),
  'utf8'
);

const READ_TABLES = [
  'network_service_path_versions',
  'network_service_path_hops',
  'network_failure_domains',
  'network_failure_domain_members',
  'network_assets',
  'services',
  'physical_topology_edges'
];

test('migration 143 grants only the linked shared-risk read surface to fiberos_app', () => {
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.fiberos_enterprise_tenant_ok\(uuid\) TO fiberos_app/i
  );

  for (const table of READ_TABLES) {
    assert.match(
      migration,
      new RegExp('GRANT SELECT ON public\\.' + table + '\\s+TO fiberos_app', 'i'),
      table + ' must be readable by the actual application role'
    );
    assert.match(
      migration,
      new RegExp('CREATE POLICY ' + table + '_app_read[\\s\\S]*FOR SELECT TO fiberos_app', 'i'),
      table + ' must have an application-role tenant policy'
    );
  }
});

test('migration 143 does not turn the linked shared-risk boundary into a write surface', () => {
  assert.match(
    migration,
    /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER[\s\S]*FROM fiberos_app/i
  );
});
