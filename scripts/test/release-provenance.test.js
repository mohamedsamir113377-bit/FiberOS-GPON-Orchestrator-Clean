#!/usr/bin/env node
'use strict';

/*
 * Contract tests for the canonical Release/Provenance generator.
 *
 * These tests prove the properties the release depends on:
 *   1. the generator never reads wall-clock time and never overwrites the
 *      release-controlled updateDate;
 *   2. manifest totals and per-file SHA-256 values are derived from the tree;
 *   3. the release documents are rendered from the manifest, so the counters
 *      quoted in prose cannot drift from the shipped bytes;
 *   4. --check is a real gate: it fails on drift and writes nothing.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test } = require('node:test');

// __dirname is scripts/test, so the repository root is two levels up.
const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'scripts/release-provenance.js'), 'utf8');
const generator = require('../release-provenance.js');

const readJson = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const readText = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

test('generator is deterministic: it must not read wall-clock time', () => {
  assert.equal(
    /new Date\s*\(|Date\.now\s*\(/.test(SOURCE),
    false,
    'release provenance generator must not depend on wall-clock time'
  );
});

test('generator preserves release-controlled updateDate', () => {
  assert.equal(
    /manifest\.updateDate\s*=/.test(SOURCE),
    false,
    'generator must not overwrite the release-controlled updateDate'
  );
});

test('generator derives the migration range from the on-disk chain', () => {
  assert.match(SOURCE, /highestMigration\s*=\s*migrationFiles\[migrationFiles\.length\s*-\s*1\]\.slice\(0,\s*3\)/);
  assert.match(SOURCE, /manifest\.databaseMigrations\s*=\s*'001-'\s*\+\s*migration\.highestMigration/);
});

test('manifest totals and hashes match the tracked source tree', () => {
  const policy = generator.readPolicy();
  const files = generator.walkFiles(policy);
  const workspace = generator.makeWorkspace();
  const totals = generator.computeTotals(workspace, policy);

  assert.equal(totals.fileCount, files.length, 'fileCount must equal the walked tree');
  assert.ok(files.length > 0, 'delivery scope must not be empty');

  let expectedBytes = 0;
  for (const rel of files) {
    if (rel === generator.MANIFEST_REL) continue;
    expectedBytes += fs.statSync(path.join(ROOT, rel)).size;
  }
  assert.equal(totals.bytes, expectedBytes, 'bytes must equal the sum of tracked file sizes');

  const manifest = readJson(generator.MANIFEST_REL);
  assert.equal(manifest.fileCount, totals.fileCount, 'committed manifest fileCount drifted from tree');
  assert.equal(manifest.bytes, totals.bytes, 'committed manifest bytes drifted from tree');
  assert.equal(manifest.sha256ByFile[generator.MANIFEST_REL], generator.SELF_MARKER);

  for (const rel of files) {
    if (rel === generator.MANIFEST_REL) continue;
    assert.equal(
      manifest.sha256ByFile[rel],
      sha256(fs.readFileSync(path.join(ROOT, rel))),
      'committed manifest hash drifted for ' + rel
    );
  }
});

test('buyer-data is generated from the same canonical source facts', () => {
  const buyer = readJson(generator.BUYER_DATA_REL);
  const manifest = readJson(generator.MANIFEST_REL);
  const parity = readJson('config/html-feature-parity.json');
  const capabilities = Array.isArray(parity.capabilities) ? parity.capabilities : [];
  const statusCounts = {};
  for (const capability of capabilities) {
    statusCounts[capability.status] = Number(statusCounts[capability.status] || 0) + 1;
  }
  assert.equal(buyer.generatedBy, 'scripts/release-provenance.js');
  assert.deepEqual(buyer.capabilities, capabilities,
    'published buyer rows must exactly match the complete canonical capability registry');
  assert.equal(buyer.capabilities.length, capabilities.length);
  assert.equal(buyer.facts.capabilityTotal, capabilities.length);
  assert.deepEqual(buyer.facts.statusCounts, statusCounts);
  assert.equal(buyer.facts.numberedMigrations, Number(String(manifest.databaseMigrations).slice(4)));
  assert.equal(buyer.facts.migrationRange, manifest.databaseMigrations);
  assert.equal(buyer.migrationRange, manifest.databaseMigrations);
  assert.equal(buyer.facts.packageVersion, readJson('package.json').version);

  // Public summaries must stay projections of the same canonical registries as detailed rows.
  assert.equal(buyer.total, capabilities.length);
  assert.deepEqual(buyer.byStatus, statusCounts);
  assert.equal(buyer.notReal, capabilities.length - Number(statusCounts.REAL || 0));
  assert.deepEqual(buyer.features, capabilities.map(capability => ({ id: capability.id, status: capability.status })));
  const localeManifest = readJson('i18n/manifest-114.generated.json');
  const localeStatusCounts = {};
  for (const locale of localeManifest.locales || []) localeStatusCounts[locale.status] = Number(localeStatusCounts[locale.status] || 0) + 1;
  assert.equal(buyer.locales.total, localeManifest.localeCount);
  assert.equal(buyer.locales.verified, Number(localeStatusCounts.verified || 0));
  assert.equal(buyer.locales.machineDraft, Number(localeStatusCounts['machine-draft'] || 0));
  assert.equal(buyer.locales.untranslated, Number(localeStatusCounts.untranslated || 0));
  assert.equal(buyer.locales.humanCertified, Number(localeManifest.officialAdoption.humanCertifiedLocaleCount || 0));
  assert.equal(buyer.facts.verifiedLocaleCount, Number(localeStatusCounts.verified || 0));
  assert.equal(buyer.facts.localeCatalogFiles, localeManifest.localeCount);
  assert.equal(buyer.facts.structuralPlaceholders, localeManifest.localeCount - Number(localeStatusCounts.verified || 0));
  assert.equal(buyer.provenance.repository, 'https://github.com/mohamedsamir113377-bit/GPON-Orchestrator.git');
  assert.equal(buyer.provenance.branch, 'NOT_BOUND_IN_GENERATOR');
  assert.equal(buyer.provenance.commit, null, 'generator must not publish a stale or invented commit SHA');
  assert.equal(buyer.provenance.sourceFile, 'config/html-feature-parity.json');
  assert.equal(buyer.provenance.sourceSha256, sha256(fs.readFileSync(path.join(ROOT, 'config/html-feature-parity.json'))));
  assert.equal(buyer.generatedFrom.sourceBranch, 'NOT_BOUND_IN_GENERATOR');
  assert.equal(buyer.generatedFrom.sourceCommit, null);
});

test('every generated release document carries its machine-rendered block', () => {
  const manifest = readJson(generator.MANIFEST_REL);
  const counters = [
    String(manifest.fileCount).replace(/\B(?=(\d{3})+(?!\d))/g, ','),
    String(manifest.bytes).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  ];

  for (const rel of generator.MARKER_DOCS) {
    const text = readText(rel);
    assert.match(text, /<!-- BEGIN GENERATED:/, rel + ' must contain a generated block');
    for (const counter of counters) {
      assert.ok(
        text.includes(counter),
        rel + ' must quote the generated counter ' + counter
      );
    }
  }

  const checksums = readText('docs/PACKAGE_CONTENTS_SHA256SUMS.txt');
  assert.match(checksums, /GENERATED by scripts\/release-provenance\.js/);
  for (const rel of generator.KEY_DELIVERABLES) {
    assert.equal(
      checksums.includes(manifest.sha256ByFile[rel]),
      true,
      'checksum file must carry the current hash of ' + rel
    );
  }
});

test('checksum file hashes match the tree for every listed deliverable', () => {
  const lines = readText('docs/PACKAGE_CONTENTS_SHA256SUMS.txt')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  assert.ok(lines.length > 0, 'checksum file must list key deliverables');

  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
    assert.ok(match, 'checksum line must be well formed: ' + line);
    const [, digest, rel] = match;
    assert.equal(
      sha256(fs.readFileSync(path.join(ROOT, rel))),
      digest,
      'stale checksum for ' + rel
    );
  }
});

test('--check passes on the committed tree and writes nothing', () => {
  const before = new Map(
    generator.GENERATED_DOCS.concat([generator.MANIFEST_REL])
      .map(rel => [rel, fs.readFileSync(path.join(ROOT, rel))])
  );

  const result = generator.runProvenance({ check: true, quiet: true });
  assert.equal(result.ok, true, 'provenance check must pass on the committed tree');
  assert.equal(result.drift.length, 0, 'provenance check must report no drift');

  for (const [rel, buffer] of before) {
    assert.equal(
      fs.readFileSync(path.join(ROOT, rel)).equals(buffer),
      true,
      '--check must not modify ' + rel
    );
  }
});

test('--check detects real drift instead of rubber-stamping', () => {
  const workspace = generator.makeWorkspace();
  const policy = generator.readPolicy();
  const version = readJson('package.json').version;
  const migration = generator.readMigrationState(workspace);

  // Simulate a hand-edited counter already committed to the repository.
  const statusRel = generator.MARKER_DOCS[0];
  workspace.stageCommitted(
    statusRel,
    readText(statusRel).replace(/<!-- BEGIN GENERATED:manifest-scope -->[\s\S]*?<!-- END GENERATED:manifest-scope -->/,
      '<!-- BEGIN GENERATED:manifest-scope -->\n- Frozen manifest scope: **1,332 hashed entries / 49,293,451 bytes** (stale hand-typed counters).\n<!-- END GENERATED:manifest-scope -->')
  );

  const { drift } = generator.detectDrift(workspace, policy, migration, version);
  assert.ok(
    drift.some(item => item.file === statusRel),
    'drift detection must flag a hand-typed counter in a release document'
  );
});

test('manifest object-key order and whitespace alone are not semantic drift', () => {
  const workspace = generator.makeWorkspace();
  const policy = generator.readPolicy();
  const version = readJson('package.json').version;
  const migration = generator.readMigrationState(workspace);
  const manifest = readJson(generator.MANIFEST_REL);
  const reordered = {
    generatedBy: manifest.generatedBy,
    sha256ByFile: Object.fromEntries(Object.entries(manifest.sha256ByFile).reverse()),
    truthBoundary: manifest.truthBoundary,
    notes: manifest.notes,
    bytes: manifest.bytes,
    fileCount: manifest.fileCount,
    databaseMigrations: manifest.databaseMigrations,
    updateDate: manifest.updateDate,
    preparedFrom: manifest.preparedFrom,
    packageVersion: manifest.packageVersion,
    package: manifest.package
  };
  workspace.stageCommitted(generator.MANIFEST_REL, JSON.stringify(reordered, null, 4) + '\n');
  const { drift } = generator.detectDrift(workspace, policy, migration, version);
  assert.equal(
    drift.some(item => item.file === generator.MANIFEST_REL),
    false,
    'reordering JSON object keys/whitespace must not invalidate equivalent manifest data'
  );
});

test('drift detection flags a tampered manifest hash entry', () => {
  const workspace = generator.makeWorkspace();
  const policy = generator.readPolicy();
  const version = readJson('package.json').version;
  const migration = generator.readMigrationState(workspace);

  const manifest = readJson(generator.MANIFEST_REL);
  const victim = 'package.json';
  manifest.sha256ByFile[victim] = 'f'.repeat(64);
  workspace.stageCommitted(generator.MANIFEST_REL, JSON.stringify(manifest, null, 2) + '\n');

  const { drift } = generator.detectDrift(workspace, policy, migration, version);
  assert.ok(
    drift.some(item => item.kind === 'manifest-hash-drift' && item.entry === victim),
    'drift detection must flag a tampered per-file SHA-256 entry'
  );
});

test('generator fails closed when migration ledgers drift', () => {
  const workspace = generator.makeWorkspace();
  const list = readText('sql/migrations/PRODUCTION_MIGRATIONS.txt')
    .split(/\r?\n/).filter(Boolean);
  workspace.stageCommitted(
    'sql/migrations/PRODUCTION_MIGRATIONS.txt',
    list.slice(0, -1).join('\n') + '\n'
  );
  assert.throws(
    () => generator.readMigrationState(workspace),
    /drifted/,
    'generator must refuse to emit provenance from a drifted migration list'
  );
});
