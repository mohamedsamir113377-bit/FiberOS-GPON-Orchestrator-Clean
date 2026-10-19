#!/usr/bin/env node
'use strict';

/*
 * Contract gate for the canonical Release/Provenance generator.
 *
 * There is exactly one implementation: scripts/release-provenance.js. The
 * historical entry points (scripts/generate-sales-manifest.js,
 * scripts/regen-manifest.js) must stay thin compatibility shims that delegate
 * to it, so a second implementation cannot reintroduce counter drift.
 *
 * These assertions target the canonical source, not the shim.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CANONICAL_REL = 'scripts/release-provenance.js';
const SOURCE = fs.readFileSync(path.join(ROOT, CANONICAL_REL), 'utf8');

// The generator must be deterministic: no wall-clock dependency anywhere.
assert.equal(
  /new Date\s*\(|Date\.now\s*\(/.test(SOURCE),
  false,
  'release provenance generator must not depend on wall-clock time'
);

// updateDate is release-controlled metadata; the generator must never write it.
assert.equal(
  /manifest\.updateDate\s*=/.test(SOURCE),
  false,
  'release provenance generator must not overwrite release-controlled updateDate'
);

// The migration range is derived from the on-disk chain, never typed by hand.
assert.match(
  SOURCE,
  /manifest\.databaseMigrations\s*=\s*'001-'\s*\+\s*migration\.highestMigration/
);

// The release documents are rendered from the manifest, not hand-maintained.
assert.match(SOURCE, /GENERATED_DOCS/, 'generator must declare its rendered documents');
assert.match(SOURCE, /replaceGeneratedBlock/, 'generator must render marker-delimited document blocks');
assert.match(SOURCE, /--check/, 'generator must expose a drift-checking mode');

// Binary deliverables must be read as raw bytes. Decoding them through a UTF-8
// round-trip silently inflates the byte total and corrupts the digest, so the
// on-disk read used for hashing must not pass an encoding argument.
assert.match(
  SOURCE,
  /committedBuffer\s*=\s*rel\s*=>\s*\{[\s\S]*?fs\.readFileSync\(path\.join\(ROOT, rel\)\);/,
  'generator must read raw bytes for hashing/byte totals'
);
assert.equal(
  /fs\.readFileSync\(path\.join\(ROOT, rel\)\)\.toString\('utf8'\)/.test(SOURCE),
  false,
  'generator must not round-trip file bytes through UTF-8'
);

// The generator fails closed when its inputs have already drifted.
assert.match(SOURCE, /drifted before provenance generation/);

// Both legacy entry points must delegate, not reimplement.
for (const shim of ['scripts/generate-sales-manifest.js', 'scripts/regen-manifest.js']) {
  const text = fs.readFileSync(path.join(ROOT, shim), 'utf8');
  assert.match(
    text,
    /require\('\.\/release-provenance\.js'\)/,
    shim + ' must delegate to the canonical release-provenance generator'
  );
  assert.equal(
    /manifest\.fileCount\s*=|manifest\.bytes\s*=|createHash/.test(text),
    false,
    shim + ' must not contain a second manifest implementation'
  );
}

console.log('Release provenance generator contract passed.');
