'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('reference capability atlas is evidence-bound and all ten records point to source/tests', () => {
  const data = JSON.parse(read('apps/ops-web/public/reference-capabilities.json'));
  assert.equal(data.capabilities.length, 10);
  assert.match(data.honestyBoundary, /copyrighted books are not reproduced/i);
  for (const entry of data.capabilities) {
    assert.match(entry.status, /SOURCE \/ UNIT-TESTED/);
    assert.ok(fs.existsSync(path.join(ROOT, entry.package.split(' + ')[0])), entry.package);
    for (const testPath of entry.tests.split(' + ')) assert.ok(fs.existsSync(path.join(ROOT, testPath)), testPath);
    assert.match(entry.limitation, /remain|not|require/i);
  }
});

test('buyer surface loads and renders the atlas through the same-origin asset', () => {
  const html = read('apps/ops-web/public/buyer.html');
  const js = read('apps/ops-web/public/buyer.js');
  const builder = read('scripts/build-netlify-site.js');
  assert.match(html, /id="reference-atlas"/);
  assert.match(html, /reference-atlas\.css/);
  assert.match(js, /reference-capabilities\.json/);
  assert.match(js, /referenceAtlas\(\)/);
  assert.match(builder, /reference-capabilities\.json/);
  assert.match(builder, /reference-atlas\.css/);
});

test('buyer capability heading closes over the local registry instead of a missing global', () => {
  const js = read('apps/ops-web/public/buyer.js');
  const iifeAt = js.indexOf('(()=>{"use strict";');
  const headingAt = js.indexOf('function syncCapabilityHeading()');
  assert.ok(iifeAt >= 0 && headingAt > iifeAt,
    'capability heading helper must be declared inside the IIFE that owns S');
  assert.match(js, /function syncCapabilityHeading\(\)[\s\S]*?S\.data\.capabilities\.length/);
});

test('tenant resolver runs only as the constrained BYPASSRLS policy reader', () => {
  const migration = read('sql/migrations/176_tenant_resolver_policy_reader_owner.sql');
  const grants = read('sql/bootstrap/20_runtime_role_grants.sql');
  assert.match(migration, /rolname\s*=\s*'fiberos_policy_reader'[\s\S]*?rolbypassrls\s*=\s*true/);
  assert.match(migration, /has_column_privilege\([\s\S]*?'public\.user_preferences'[\s\S]*?'user_id'[\s\S]*?'SELECT'/);
  assert.match(migration, /has_column_privilege\([\s\S]*?'public\.user_preferences'[\s\S]*?'tenant_id'[\s\S]*?'SELECT'/);
  assert.match(migration, /GRANT SELECT \(user_id, tenant_id\) ON public\.user_preferences TO fiberos_policy_reader/);
  // OWNER TO must run as superuser in post-migration bootstrap (not under migrator).
  assert.match(grants, /ALTER FUNCTION public\.fiberos_current_tenant_id\(\) OWNER TO fiberos_policy_reader/);
});
