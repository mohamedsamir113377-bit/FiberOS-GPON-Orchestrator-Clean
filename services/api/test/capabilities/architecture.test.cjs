'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { buildArchitectureMap, auditAgainstRepository } = require('../../src/capabilities/architecture.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fn-arch-'));
  for (const [d, n] of [['packages', 'core'], ['services', 'api'], ['apps', 'ops-web']]) {
    fs.mkdirSync(path.join(root, d, n), { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'packages', 'core', 'package.json'), '{"name":"core"}');
  fs.mkdirSync(path.join(root, 'sql', 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sql', 'migrations', '001_init.sql'), 'select 1;');
  fs.writeFileSync(path.join(root, 'sql', 'migrations', '188_enterprise_time_machine.sql'), 'select 1;');
  return root;
}
test('builds a component map from the real tree', () => {
  const root = fixture();
  const map = buildArchitectureMap(root);
  assert.equal(map.counts.packages, 1);
  assert.equal(map.counts.services, 1);
  assert.equal(map.counts.apps, 1);
  assert.equal(map.migrationCount, 2);
  assert.equal(map.lastMigration, '188_enterprise_time_machine.sql');
  assert.deepEqual(auditAgainstRepository(root, map), { ok: true, checked: 3, errors: [] });
});
test('rejects an empty root', () => { assert.throws(() => buildArchitectureMap(''), TypeError); });
test('audit fails when a claimed component does not exist', () => {
  const root = fixture();
  const map = buildArchitectureMap(root);
  map.components.push({ name: 'ghost', kind: 'service', hasManifest: false });
  const res = auditAgainstRepository(root, map);
  assert.equal(res.ok, false);
  assert.deepEqual(res.errors, ['absent:service:ghost']);
});
