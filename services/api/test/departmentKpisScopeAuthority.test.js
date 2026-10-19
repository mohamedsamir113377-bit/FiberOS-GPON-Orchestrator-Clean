'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const migration = fs.readFileSync(path.join(root, 'sql/migrations/160_department_scope_authority.sql'), 'utf8');
const hardening = fs.readFileSync(path.join(root, 'sql/migrations/161_department_scope_authority_cycle_hardening.sql'), 'utf8');
const homeIntegrity = fs.readFileSync(path.join(root, 'sql/migrations/169_department_scope_home_integrity.sql'), 'utf8');
const route = fs.readFileSync(path.join(root, 'services/api/src/routes/departmentKpis.js'), 'utf8');

test('department scope authority is explicit and database-session bound', () => {
  assert.match(migration, /scope_type IN \([\s\S]*'department'/);
  assert.match(migration, /department_kpi:read/);
  assert.match(migration, /fiberos_session_tenant_id\(\)/);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /valid_from <= now\(\)/);
  assert.match(migration, /sg\.valid_to IS NULL OR sg\.valid_to > now\(\)/);
  assert.match(migration, /sg\.scope_id IN \(SELECT id FROM hierarchy\)/);
  assert.match(migration, /JOIN hierarchy child ON child\.parent_id = parent\.id/);
  assert.match(migration, /REVOKE ALL ON FUNCTION/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION/);
  assert.match(hardening, /NOT parent\.id = ANY\(child\.path\)/);
  assert.match(hardening, /p_capability = 'department_kpi:read'/);
  assert.match(hardening, /STABLE/);
  assert.match(hardening, /SECURITY DEFINER/);
  assert.match(hardening, /SET search_path = pg_catalog, public, auth/);
  assert.match(hardening, /REVOKE ALL ON FUNCTION/);
  assert.match(hardening, /GRANT EXECUTE ON FUNCTION/);
  assert.match(homeIntegrity, /JOIN public\.enterprise_departments home/);
  assert.match(homeIntegrity, /home\.id = ep\.department_id/);
  assert.match(homeIntegrity, /home\.active = true/);
  assert.match(homeIntegrity, /NOT parent\.id = ANY\(child\.path\)/);
  assert.match(homeIntegrity, /p_capability = 'department_kpi:read'/);
  assert.match(homeIntegrity, /REVOKE ALL ON FUNCTION/);
  assert.match(homeIntegrity, /GRANT EXECUTE ON FUNCTION/);
});

test('department KPI route delegates scope authority to the database function', () => {
  assert.match(route, /fiberos_enterprise_department_scope_allowed\(\$1, 'department_kpi:read'\)/);
  assert.match(route, /DEPARTMENT_SCOPE_REQUIRED/);
  assert.doesNotMatch(route, /sg\.scope_type='enterprise'/);
  assert.doesNotMatch(route, /tenant-derived-id/);
  assert.doesNotMatch(route, /sg\.scope_id is null/);
});
