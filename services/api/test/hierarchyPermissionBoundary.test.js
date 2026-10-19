'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('field-close, evidence, and ticket routes use immutable DB-derived permission context', () => {
  for (const file of ['services/api/src/routes/fieldClose.js', 'services/api/src/routes/evidence.js', 'services/api/src/routes/tickets.js']) {
    const source = read(file);
    assert.match(source, /loadImmutablePermissionContext/);
    assert.match(source, /assertTechnician(Read|Mutation)Allowed/);
  }
  const fieldClose = read('services/api/src/routes/fieldClose.js');
  assert.match(fieldClose, /evaluateOptionalSupervisorOverride/);
  assert.match(fieldClose, /fiberos_audit_append/);
  assert.match(fieldClose, /PRIVILEGE_AUDIT_LEDGER_REQUIRED/);
});

test('dispatch route filters supervisor candidates through materialized subordinate scope', () => {
  const source = read('services/api/src/routes/operations.js');
  assert.match(source, /canSupervisorActOnTechnician/);
  assert.match(source, /technician_subordinates|permissionContext\.subordinates/);
  assert.match(source, /t\.id = any\(\$2::uuid\[\]\)/);
});

test('hierarchy migration has tenant-consistent subordinate materialization and forced RLS', () => {
  const sql = read('sql/migrations/112_technician_hierarchy_scope_materialization.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS technician_subordinates/);
  assert.match(sql, /trg_technician_subordinate_tenant/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON technician_subordinates/);
  assert.match(sql, /CREATE POLICY tickets_field_scope_select/);
});


test('migration 185 replaces same-tenant area-supervisor escapes across field and incident resources', () => {
  const sql = read('sql/migrations/185_enforce_area_supervisor_resource_scope.sql');
  for (const name of [
    'fiberos_area_supervisor_technician_scope',
    'fiberos_area_supervisor_ticket_scope',
    'fiberos_area_supervisor_call_scope',
    'fiberos_area_supervisor_conversation_scope',
    'fiberos_area_supervisor_incident_scope',
    'fiberos_current_user_ticket_scope',
    'fiberos_has_any_role(ARRAY[\'area_supervisor\'])',
    'DROP POLICY IF EXISTS technicians_select_tenant',
    'DROP POLICY IF EXISTS tickets_select_tenant',
    'DROP POLICY IF EXISTS tickets_app_kpi_read',
    'DROP POLICY IF EXISTS evidence_select_tenant',
    'DROP POLICY IF EXISTS incident_command_links_select',
    'DROP POLICY IF EXISTS material_reel_ledger_select',
    'AREA_SUPERVISOR_CANNOT_MUTATE_TECHNICIAN_AUTHORITY_FIELDS'
  ]) assert.ok(sql.includes(name), 'migration must include ' + name);
});
