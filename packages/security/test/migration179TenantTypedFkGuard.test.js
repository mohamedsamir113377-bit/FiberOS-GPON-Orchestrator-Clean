'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const MIGRATION_NAME = '179_tenant_typed_fk_guard_and_portal_subscription_scope.sql';
const MIGRATION_180_NAME = '180_exhaustive_tenant_fk_mutation_guards.sql';
const SQL = read('sql/migrations/' + MIGRATION_NAME);
const SQL_180 = read('sql/migrations/' + MIGRATION_180_NAME);
const AUDIT = read('scripts/buyer-acceptance/adversarial-tenant-fk-mutation-audit.js');

test('migration 179 compares FK values using their native SQL types', () => {
  assert.match(SQL, /WHERE %I = \(\$1\)\.%I LIMIT 1/);
  assert.match(SQL, /EXECUTE sql INTO ref_tenant USING NEW/);
  assert.doesNotMatch(SQL, /ref_id\s+uuid/);
  assert.match(SQL, /TENANT_MISMATCH_%_%/);
  assert.match(SQL, /TENANT_REFERENCE_MISSING_OR_NOT_VISIBLE_%_%/);
});

test('portal subscription events bind the tenant and subscription in one composite FK', () => {
  assert.match(SQL, /UNIQUE \(tenant_id, id\)/);
  assert.match(SQL, /FOREIGN KEY \(tenant_id, subscription_id\)\s+REFERENCES public\.portal_subscriptions \(tenant_id, id\)/);
  assert.match(SQL, /DROP CONSTRAINT IF EXISTS portal_subscription_events_subscription_id_fkey/);
});

test('runtime tenant-FK audit exercises single and composite references and fails closed', () => {
  assert.match(AUDIT, /for \(const fk of fkRows\.rows\)/);
  assert.match(AUDIT, /same_tenant_probe/);
  assert.match(AUDIT, /cross_tenant_probe/);
  assert.match(AUDIT, /BLOCKED_TENANT_COMPOSITE_FK/);
  assert.match(AUDIT, /assert\.equal\(results\.length, inventoryCount/);
  assert.match(AUDIT, /assert\.equal\(notProven, 0/);
  assert.match(AUDIT, /isolateFkProbeTriggers\(client, fk, nativeTenantKey\)/);
  assert.match(AUDIT, /alter table .* disable trigger user/);
  assert.match(AUDIT, /fiberos_guard_composite_fk_tenant_match/);
  assert.match(AUDIT, /TENANT\(\?:_\[A-Z0-9\]\+\)\*_\(\?:MISMATCH\|CONTEXT\|SCOPE\)/);
  assert.doesNotMatch(AUDIT, /append-only\|immutable\|not permitted/);
});

test('fixture insert retries roll back to a per-attempt savepoint', () => {
  assert.match(AUDIT, /savepoint fixture_insert_attempt[\s\S]*?rollback to savepoint fixture_insert_attempt[\s\S]*?release savepoint fixture_insert_attempt/);
});

test('migration 179 is registered and its extension-ledger checksum is exact', () => {
  const list = read('sql/migrations/PRODUCTION_MIGRATIONS.txt').split(/\r?\n/).filter(Boolean);
  assert.ok(list.includes(MIGRATION_NAME));
  const listedLine = read('sql/migrations/PRODUCTION_MIGRATIONS.extra.sha256')
    .split(/\r?\n/)
    .find((line) => line.trim().endsWith('  ' + MIGRATION_NAME));
  assert.ok(listedLine, 'migration checksum line missing');
  const expected = crypto.createHash('sha256').update(SQL).digest('hex');
  assert.equal(listedLine.trim().split(/\s+/)[0], expected);
});

test('migration 180 discovers every tenant-bearing FK missing a native tenant key pair', () => {
  assert.match(SQL_180, /fiberos_guard_composite_fk_tenant_match/);
  assert.match(SQL_180, /FROM pg_constraint con/);
  assert.match(SQL_180, /has_native_tenant_pair/);
  assert.match(SQL_180, /con\.contype = 'f'/);
  assert.match(SQL_180, /CREATE TRIGGER/);
  assert.match(SQL_180, /TENANT_REFERENCE_MISSING_OR_NOT_VISIBLE_%_%/);
  assert.match(SQL_180, /TENANT_MISMATCH_%_%/);
});

test('migration 180 is registered and its extension-ledger checksum is exact', () => {
  const list = read('sql/migrations/PRODUCTION_MIGRATIONS.txt').split(/\r?\n/).filter(Boolean);
  assert.ok(list.includes(MIGRATION_180_NAME));
  const listedLine = read('sql/migrations/PRODUCTION_MIGRATIONS.extra.sha256')
    .split(/\r?\n/)
    .find((line) => line.trim().endsWith('  ' + MIGRATION_180_NAME));
  assert.ok(listedLine, 'migration checksum line missing');
  const expected = crypto.createHash('sha256').update(SQL_180).digest('hex');
  assert.equal(listedLine.trim().split(/\s+/)[0], expected);
});
