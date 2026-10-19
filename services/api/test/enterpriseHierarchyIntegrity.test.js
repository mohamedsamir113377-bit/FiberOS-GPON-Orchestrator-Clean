'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../..');
const read = relativePath => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

test('enterprise hierarchy cycle integrity is enforced by PostgreSQL migration 159', () => {
  const source = read('sql/migrations/159_enterprise_hierarchy_cycle_integrity.sql');

  assert.match(source, /CREATE OR REPLACE FUNCTION public\.fiberos_enterprise_department_cycle_guard\(\)/);
  assert.match(source, /CREATE OR REPLACE FUNCTION public\.fiberos_enterprise_position_cycle_guard\(\)/);
  assert.match(source, /SECURITY DEFINER/);
  assert.match(source, /SET search_path = pg_catalog, public, auth/);

  assert.match(source, /WITH RECURSIVE walk/);
  assert.match(source, /d\.tenant_id = NEW\.tenant_id/);
  assert.match(source, /p\.tenant_id = NEW\.tenant_id/);
  assert.match(source, /d\.id = ANY\(w\.visited\)/);
  assert.match(source, /p\.id = ANY\(w\.visited\)/);
  assert.match(source, /AND NOT w\.has_cycle/);
  assert.match(source, /ENTERPRISE_DEPARTMENT_PARENT_CYCLE/);
  assert.match(source, /ENTERPRISE_POSITION_MANAGER_CYCLE/);
  assert.match(source, /USING ERRCODE = '23514'/);
  assert.match(source, /trg_enterprise_department_cycle_guard/);
  assert.match(source, /trg_enterprise_position_cycle_guard/);
  assert.match(source, /REVOKE ALL ON FUNCTION public\.fiberos_enterprise_department_cycle_guard\(\)/);
  assert.match(source, /REVOKE ALL ON FUNCTION public\.fiberos_enterprise_position_cycle_guard\(\)/);
});
