'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { findStaleMigrationRanges, currentMigrationScope } = require('../verify-docs-migration-alignment');

test('migration alignment detects plain hyphen and en dash ranges', () => {
  const text = 'A 001-127 range and a 001–126 range are stale; 001-158 is current.';
  const stale = findStaleMigrationRanges(text, '158', 'fixture.md');
  assert.deepEqual(stale, [
    'fixture.md: found 001-127 (expected 001-158)',
    'fixture.md: found 001-126 (expected 001-158)'
  ]);
});

test('migration alignment detects backticked Markdown ranges', () => {
  const text = 'Old references: `001–127` and `001-141`. Current: `001–158`.';
  const stale = findStaleMigrationRanges(text, '158', 'BUYER_QUICKSTART.md');
  assert.deepEqual(stale, [
    'BUYER_QUICKSTART.md: found 001-127 (expected 001-158)',
    'BUYER_QUICKSTART.md: found 001-141 (expected 001-158)'
  ]);
});

test('migration alignment does not flag the current range', () => {
  assert.deepEqual(
    findStaleMigrationRanges('Current `001–158` and 001-158.', '158', 'current.md'),
    []
  );
});

test('migration alignment excludes historical ranges after level-2 or level-3 delivery-gate headings', () => {
  const current = 'Current range: 001-181.\n';
  for (const heading of [
    '## Delivery-gate closure progress (2026-10-08)',
    '### Delivery-gate closure progress (2026-10-08)'
  ]) {
    const text = current + heading + '\nHistorical reference: 001-178.\n';
    assert.equal(currentMigrationScope(text, 'FINAL_VERIFICATION_STATUS.md'), current);
  }
});

test('current deployment runbooks do not regress to retired migration history claims', () => {
  const root = path.resolve(__dirname, '../..');
  // Derive the expected count and tip from the on-disk chain instead of hardcoding
  // a historical snapshot: the runbooks must track the CURRENT chain, so a stale
  // count (e.g. 182/188 text on a 189-migration chain) can never pass again.
  const migrationDir = path.join(root, 'sql/migrations');
  const migrationFiles = fs.readdirSync(migrationDir)
    .filter((n) => /^\d{3}_.+\.sql$/.test(n) && n !== '000_local_auth_stubs.sql')
    .sort();
  assert.ok(migrationFiles.length > 0, 'no production migrations on disk');
  const tip = migrationFiles[migrationFiles.length - 1];
  const count = String(migrationFiles.length);
  const buyerAcceptance = fs.readFileSync(
    path.join(root, 'docs/runbooks/BUYER_GO_LIVE_ACCEPTANCE.md'),
    'utf8'
  );
  const productionChecklist = fs.readFileSync(
    path.join(root, 'docs/runbooks/PRODUCTION_DEPLOYMENT_CHECKLIST.md'),
    'utf8'
  );
  for (const text of [buyerAcceptance, productionChecklist]) {
    assert.doesNotMatch(text, /121_tenant_containment_closure\.sql/);
    assert.doesNotMatch(text, /history count\s*=\s*\*\*179\*\*/i);
    assert.doesNotMatch(text, /179_\*\.sql/);
  }
  assert.match(buyerAcceptance, new RegExp(`migration history count is \\*\\*${count}\\*\\*`, 'i'));
  assert.ok(buyerAcceptance.includes('last migration `' + tip + '`'), 'buyer acceptance must cite the current tip: ' + tip);
  assert.match(productionChecklist, new RegExp(`history count = \\*\\*${count}\\*\\*`, 'i'));
  assert.ok(productionChecklist.includes(tip), 'production checklist must cite the current tip: ' + tip);
});
