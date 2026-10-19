'use strict';
// Guards the Enterprise Time Machine hardening: migration 190 must exist, must fix the
// two proven defects, and must stay consistent with its manifests and config.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..', '..', '..');
const MIG = path.join(ROOT, 'sql', 'migrations');
const NAME = '190_enterprise_time_machine_hardening.sql';
const SQL = fs.readFileSync(path.join(MIG, NAME), 'utf8');

test('migration 190 exists and is a transactional file', () => {
  assert.ok(SQL.length > 1500);
  assert.match(SQL, /^-- Migration 190/m);
  assert.match(SQL, /\nBEGIN;/);
  assert.match(SQL, /\nCOMMIT;/);
});

test('D1 is fixed: the verifier restarts its chain per tenant', () => {
  const fn = SQL.slice(SQL.indexOf('FUNCTION ecl_verify_chain'));
  assert.match(fn, /chain\s*:=\s*NULL/);
  assert.match(fn, /ORDER BY tenant_id,\s*seq/);
  assert.match(fn, /IS DISTINCT FROM cur/);
  // the legacy global-prev declaration must be gone
  assert.doesNotMatch(SQL, /prev\s+text\s*:=\s*NULL/);
});

test('D2 is fixed: actor is part of the hashed payload in writer and verifier', () => {
  const writer = SQL.slice(SQL.indexOf('FUNCTION ecl_chain'), SQL.indexOf('FUNCTION ecl_verify_chain'));
  const verifier = SQL.slice(SQL.indexOf('FUNCTION ecl_verify_chain'));
  assert.match(writer, /coalesce\(NEW\.actor,''\)/);
  assert.match(verifier, /coalesce\(r\.actor,''\)/);
  assert.match(writer, /NEW\.hash_version\s*:=\s*2/);
  assert.match(SQL, /hash_version smallint NOT NULL DEFAULT 1/);
});

test('capture attachment is idempotent and skips absent tables', () => {
  assert.match(SQL, /CREATE OR REPLACE FUNCTION ecl_attach_capture/);
  assert.match(SQL, /to_regclass\('public\.' \|\| p_table\) IS NULL/);
  assert.match(SQL, /DROP TRIGGER IF EXISTS %I ON public\.%I/);
});

test('the inlined capture list matches config/ecl-capture-tables.v1.json', () => {
  const cfgPath = path.join(ROOT, 'config', 'ecl-capture-tables.v1.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.equal(cfg.schema, 'fiberos.ecl-capture-tables.v1');
  assert.equal(cfg.migration, 'sql/migrations/191_ecl_event_outbox_pk_fix.sql');
  assert.equal(cfg.policy.perTenantChain, true);
  assert.equal(cfg.policy.actorBoundHash, true);
  const block = SQL.split('-- ecl-capture-core:begin')[1].split('-- ecl-capture-core:end')[0];
  const inlined = [...block.matchAll(/ecl_attach_capture\('([a-z0-9_]+)',\s*'([a-z0-9_]+)'\)/g)].map((m) => ({ table: m[1], pk: m[2] }));
  assert.ok(inlined.length === cfg.coreTables.length && inlined.length > 0, 'list length mismatch');
  // Migration 191 intentionally overrides only event_outbox_contract's PK after
  // migration 190's inline list was found to use a nonexistent "id" column.
  const effective = inlined.map((entry) =>
    entry.table === 'event_outbox_contract' ? { ...entry, pk: 'event_id' } : entry
  );
  assert.deepEqual(effective, cfg.coreTables.map((t) => ({ table: t.table, pk: t.pk })));
  const fix = fs.readFileSync(path.join(MIG, '191_ecl_event_outbox_pk_fix.sql'), 'utf8');
  assert.match(fix, /ecl_attach_capture\('event_outbox_contract',\s*'event_id'\)/);
  assert.match(fix, /position\('ecl_capture\(''event_id''\)' IN def\)/);
});

test('190 is registered in both production manifests with the correct digest', () => {
  const list = fs.readFileSync(path.join(MIG, 'PRODUCTION_MIGRATIONS.txt'), 'utf8');
  assert.match(list, new RegExp('^' + NAME + '$', 'm'));
  const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(MIG, NAME))).digest('hex');
  const extra = fs.readFileSync(path.join(MIG, 'PRODUCTION_MIGRATIONS.extra.sha256'), 'utf8');
  const line = extra.split(/\r?\n/).find((l) => l.endsWith(NAME));
  assert.ok(line, '190 missing from the extension digest ledger');
  assert.equal(line.trim().split(/\s+/)[0], digest);
});
