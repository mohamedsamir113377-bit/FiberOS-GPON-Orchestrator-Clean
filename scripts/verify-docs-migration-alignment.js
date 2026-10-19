#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIG_DIR = path.join(ROOT, 'sql/migrations');
const DOC_PATHS = [
  'SECURITY.md', 'FINAL_VERIFICATION_STATUS.md', 'BUYER_QUICKSTART.md',
  'docs/commercial/COMMERCIAL_RELEASE_STATUS.md',
  'docs/runbooks/SOURCE_PROVENANCE.md',
  'docs/runbooks/PRODUCTION_DEPLOYMENT_CHECKLIST.md'
];
function highestMigration() {
  const files = fs.readdirSync(MIG_DIR)
    .filter((n) => /^\d{3}_.+\.sql$/.test(n) && n !== '000_local_auth_stubs.sql')
    .sort();
  if (!files.length) throw new Error('no production migrations on disk');
  return files[files.length - 1].slice(0, 3);
}
function currentMigrationScope(text, rel) {
  const source = String(text || '');
  if (rel === 'FINAL_VERIFICATION_STATUS.md') {
    const historyStart = source.search(/^#{2,3} Delivery-gate closure progress \(\d{4}-\d{2}-\d{2}\)$/m);
    return historyStart < 0 ? source : source.slice(0, historyStart);
  }
  return source;
}
function findStaleMigrationRanges(text, highest, rel = 'document') {
  const stale = [];
  const chainRe = /`?001[\u2013-](\d{3})`?/g;
  let match;
  while ((match = chainRe.exec(String(text || ''))) !== null) {
    if (match[1] !== String(highest)) stale.push(`${rel}: found 001-${match[1]} (expected 001-${highest})`);
  }
  return stale;
}
function main() {
  const highest = highestMigration();
  const stale = [];
  for (const rel of DOC_PATHS) {
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs)) stale.push(...findStaleMigrationRanges(currentMigrationScope(fs.readFileSync(abs, 'utf8'), rel), highest, rel));
  }
  if (stale.length) {
    console.error('DOCS_MIGRATION_ALIGNMENT_FAIL:');
    for (const item of stale) console.error('  - ' + item);
    process.exitCode = 1;
    return false;
  }
  console.log(`DOCS_MIGRATION_ALIGNMENT PASS: docs agree with on-disk chain 001-${highest}`);
  return true;
}
if (require.main === module) {
  try { main(); } catch (error) { console.error('DOCS_MIGRATION_ALIGNMENT_FAIL: ' + error.message); process.exitCode = 1; }
}
module.exports = { currentMigrationScope, findStaleMigrationRanges, highestMigration, main };
