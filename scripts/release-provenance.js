#!/usr/bin/env node
'use strict';

/*
 * FiberOS R14.1 — Release/Provenance Generator (single canonical implementation).
 *
 * Problem this closes: release truth (file counts, byte totals, migration
 * range, per-file SHA-256, and the numbers quoted inside the release
 * documents) used to be maintained by hand in more than one place. Hand-typed
 * counters drift silently from the source tree, so the seller could publish a
 * manifest or a receipt that disagreed with the bytes actually shipped.
 *
 * Single direction of truth:
 *
 *     source tree  ->  generated manifest  ->  generated release documents
 *
 * Everything derived is computed from the tracked tree; nothing derived is
 * typed by hand. `--check` recomputes the whole chain in memory and fails
 * closed on any drift, so CI can prove the committed artifacts still match
 * the committed source.
 *
 * Determinism: this generator never reads wall-clock time. Release-controlled
 * metadata (updateDate, truthBoundary, narrative notes) is preserved, not
 * manufactured. Two runs over the same tree produce byte-identical output.
 *
 * Fixed point: the release documents quote the totals, and the documents are
 * themselves hashed into the manifest, so rendering is iterated until the
 * rendered text stops changing (bounded). The manifest is self-excluded from
 * byte totals via SELF_REFERENTIAL_NOT_HASHED, so it cannot hash its own bytes.
 *
 * Usage:
 *   node scripts/release-provenance.js           # regenerate manifest + docs
 *   node scripts/release-provenance.js --check    # verify, write nothing, fail on drift
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_REL = 'SALES_PACKAGE_MANIFEST.json';
const POLICY_REL = 'config/delivery-scope-policy.json';
const MIGRATIONS_REL = 'sql/migrations';
const RLS_INVENTORY_REL = 'config/rls-tenant-sensitive-inventory.json';
const PRODUCTION_LIST_REL = MIGRATIONS_REL + '/PRODUCTION_MIGRATIONS.txt';
const PRODUCTION_HASH_REL = MIGRATIONS_REL + '/PRODUCTION_MIGRATIONS.sha256';
const PRODUCTION_HASH_EXTRA_REL = MIGRATIONS_REL + '/PRODUCTION_MIGRATIONS.extra.sha256';
const BUYER_DATA_REL = 'apps/ops-web/public/buyer-data.json';
const CAPABILITY_PARITY_REL = 'config/html-feature-parity.json';
const SELF_MARKER = 'SELF_REFERENTIAL_NOT_HASHED';

/** Documents rendered from the manifest. Each is declared here exactly once. */
const GENERATED_DOCS = Object.freeze([
  'apps/ops-web/public/buyer-data.json',
  'docs/commercial/COMMERCIAL_RELEASE_STATUS.md',
  'docs/commercial/COMMERCIAL_RELEASE_RECEIPT.md',
  'FINAL_VERIFICATION_STATUS.md',
  'docs/PACKAGE_CONTENTS_SHA256SUMS.txt'
]);

/** Release documents that carry a machine-rendered block (marker-delimited). */
const MARKER_DOCS = Object.freeze([
  'docs/commercial/COMMERCIAL_RELEASE_STATUS.md',
  'docs/commercial/COMMERCIAL_RELEASE_RECEIPT.md',
  'FINAL_VERIFICATION_STATUS.md'
]);

/**
 * Curated "key packaged deliverables" list for docs/PACKAGE_CONTENTS_SHA256SUMS.txt.
 *
 * Every entry must exist in the tracked tree. The previous list carried four
 * phantom paths (buyer-demo HTML/AR report and two i18n audit JSON files) that
 * existed at neither the handoff base nor this branch head, so the published
 * checksum file referenced artifacts the buyer could never verify. The
 * generator now fails closed if any declared deliverable is absent.
 */
const KEY_DELIVERABLES = Object.freeze([
  'LICENSE',
  'SECURITY.md',
  'BUYER_QUICKSTART.md',
  'SBOM.cdx.json',
  'ARCHITECTURE_MAP.json',
  'SALES_PACKAGE_MANIFEST.schema.json',
  'config/commercial-release-contract.v1.json',
  'docs/commercial/COMMERCIAL_RELEASE_STATUS.md',
  'docs/commercial/COMMERCIAL_RELEASE_RECEIPT.md',
  'docs/commercial/ONLINE_COMMERCIAL_LICENSE.md',
  'docs/commercial/SALES_AGREEMENT_TEMPLATE.md',
  'docs/commercial/ENGINEERING_TECHNICAL_SPECIFICATION.md',
  'i18n/manifest.json',
  'i18n/source.json'
]);

const MAX_RENDER_PASSES = 8;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * JSON object member order and insignificant whitespace are not semantic data.
 * Compare parsed manifest values canonically so a harmless serializer/order
 * change cannot block release admission; every declared file hash and manifest
 * value is still compared, and the parity gate independently checks tree bytes.
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = canonicalJson(value[key]);
      return out;
    }, {});
  }
  return value;
}

function sameJsonValue(left, right) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function readPolicy() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, POLICY_REL), 'utf8'));
}

/**
 * Delivery-scope exclusion predicate. Kept byte-compatible with the release
 * manifest parity gate so both always walk the same file set.
 */
function isExcluded(rel, policy) {
  const exclusions = policy.sourceExclusions;
  const parts = rel.split('/');
  if (parts.some(part => exclusions.directoryNames.includes(part))) return true;
  if (exclusions.rootDirectories.some(dir => rel === dir || rel.startsWith(dir + '/'))) return true;
  if (parts.length === 1 && new RegExp(exclusions.rootFileRegex).test(rel)) return true;
  return exclusions.files.includes(rel);
}

/** Deterministic, sorted inventory of the tracked delivery-scope source tree. */
function walkFiles(policy, dir = ROOT, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    if (isExcluded(rel, policy)) continue;
    if (entry.isDirectory()) walkFiles(policy, full, out);
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}

/**
 * Copy-on-write workspace. In `--check` mode nothing is ever flushed to disk,
 * so verification cannot mutate the tree it is verifying.
 */
function makeWorkspace() {
  const overlay = new Map();    // staged writes: what the generator intends to publish
  const committed = new Map();  // simulated on-disk state, used by drift tests

  const committedText = rel => {
    if (committed.has(rel)) return committed.get(rel);
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  };

  /**
   * Raw bytes, never a UTF-8 round-trip. Binary deliverables (the visual
   * regression baselines) must contribute their true byte length and digest;
   * decoding them to a string and re-encoding corrupts both.
   */
  const committedBuffer = rel => {
    if (committed.has(rel)) return Buffer.from(committed.get(rel), 'utf8');
    return fs.readFileSync(path.join(ROOT, rel));
  };

  return {
    overlay,
    committed,
    readText(rel) {
      if (overlay.has(rel)) return overlay.get(rel);
      return committedText(rel);
    },
    readBuffer(rel) {
      if (overlay.has(rel)) return Buffer.from(overlay.get(rel), 'utf8');
      return committedBuffer(rel);
    },
    /** The already-committed content — the overlay is deliberately ignored. */
    readCommitted: committedText,
    exists(rel) {
      return overlay.has(rel) || committed.has(rel) || fs.existsSync(path.join(ROOT, rel));
    },
    stage(rel, content) {
      overlay.set(rel, content);
    },
    /** Test-only: pretend the repository already contains this content. */
    stageCommitted(rel, content) {
      committed.set(rel, content);
    },
    commit() {
      for (const [rel, content] of overlay) {
        fs.writeFileSync(path.join(ROOT, rel), content, 'utf8');
      }
    }
  };
}

/**
 * Totals + per-file hashes for the tracked tree.
 *
 * The manifest's own bytes are excluded (a file cannot hash itself), and
 * fileCount counts the tree as walked, matching the parity gate.
 */
function computeTotals(workspace, policy) {
  const files = walkFiles(policy);
  const hashes = {};
  let bytes = 0;
  for (const rel of files) {
    if (rel === MANIFEST_REL) {
      hashes[rel] = SELF_MARKER;
      continue;
    }
    const buffer = workspace.readBuffer(rel);
    bytes += buffer.length;
    hashes[rel] = sha256(buffer);
  }
  return { files, fileCount: files.length, bytes, hashes };
}

function parseHashLines(lines, label) {
  const listed = new Map();
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})\s+(.+)$/i);
    if (!match) throw new Error('Invalid ' + label + ' line: ' + line);
    listed.set(match[2], match[1].toLowerCase());
  }
  return listed;
}

/**
 * Migration truth: the on-disk chain, its list, its SHA-256 ledgers and the RLS
 * inventory counters must already agree before any release artifact is written.
 * Fails closed rather than emitting a manifest built on drifted inputs.
 */
function readMigrationState(workspace) {
  const dir = path.join(ROOT, MIGRATIONS_REL);
  const migrationFiles = fs.readdirSync(dir)
    .filter(name => /^\d{3}_.+\.sql$/.test(name))
    .filter(name => name !== '000_local_auth_stubs.sql')
    .sort();
  if (!migrationFiles.length) throw new Error('No production SQL migrations found.');

  const highestMigration = migrationFiles[migrationFiles.length - 1].slice(0, 3);
  const productionList = workspace.readText(PRODUCTION_LIST_REL)
    .split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (JSON.stringify(productionList) !== JSON.stringify(migrationFiles)) {
    throw new Error('PRODUCTION_MIGRATIONS.txt drifted from sql/migrations before provenance generation.');
  }

  const inventory = JSON.parse(workspace.readText(RLS_INVENTORY_REL));
  if (Number(inventory && inventory.source && inventory.source.migrationCount) !== migrationFiles.length) {
    throw new Error('RLS inventory source.migrationCount drifted before provenance generation.');
  }
  if (Number(inventory && inventory.migrationCount) !== migrationFiles.length) {
    throw new Error('RLS inventory migrationCount drifted before provenance generation.');
  }

  const legacyHashLines = workspace.readText(PRODUCTION_HASH_REL)
    .split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const extraHashLines = workspace.exists(PRODUCTION_HASH_EXTRA_REL)
    ? workspace.readText(PRODUCTION_HASH_EXTRA_REL).split(/\r?\n/).map(x => x.trim()).filter(Boolean)
    : [];

  const legacyFiles = migrationFiles.filter(name => Number(name.slice(0, 3)) <= 116);
  const extensionFiles = migrationFiles.filter(name => Number(name.slice(0, 3)) >= 117);
  const legacyListed = parseHashLines(legacyHashLines, 'PRODUCTION_MIGRATIONS.sha256');
  const extraListed = parseHashLines(extraHashLines, 'PRODUCTION_MIGRATIONS.extra.sha256');

  if (legacyHashLines.length !== legacyFiles.length) {
    throw new Error('PRODUCTION_MIGRATIONS.sha256 legacy line count drifted.');
  }
  if (extraHashLines.length !== extensionFiles.length) {
    throw new Error('PRODUCTION_MIGRATIONS.extra.sha256 line count drifted.');
  }

  for (const name of legacyFiles) {
    const actual = sha256(workspace.readBuffer(MIGRATIONS_REL + '/' + name));
    if (legacyListed.get(name) !== actual) {
      throw new Error('Migration SHA-256 drifted before provenance generation: ' + name);
    }
  }
  for (const name of extensionFiles) {
    const actual = sha256(workspace.readBuffer(MIGRATIONS_REL + '/' + name));
    if (extraListed.get(name) !== actual) {
      throw new Error('Migration extension SHA-256 drifted before provenance generation: ' + name);
    }
  }

  return { migrationFiles, highestMigration, chain: '001-' + highestMigration };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replace the marker-delimited block `id` inside `text`, or throw if absent. */
function replaceGeneratedBlock(text, id, body) {
  const begin = '<!-- BEGIN GENERATED:' + id + ' -->';
  const end = '<!-- END GENERATED:' + id + ' -->';
  const pattern = new RegExp(escapeRegExp(begin) + '[\\s\\S]*?' + escapeRegExp(end));
  if (!pattern.test(text)) {
    throw new Error('Missing generated block "' + id + '" (' + begin + ' ... ' + end + ')');
  }
  return text.replace(pattern, begin + '\n' + body.trim() + '\n' + end);
}

function formatNumber(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The generated text for each release document, derived only from `totals`. */
function renderDocs(totals, migration, version, policy, readSource = defaultSourceReader) {
  const chain = '001\u2013' + migration.highestMigration;
  const exclusions = policy.sourceExclusions.files.map(f => '`' + f + '`').join(', ');
  const count = formatNumber(totals.fileCount);
  const bytes = formatNumber(totals.bytes);

  const statusBlock = [
    '- Frozen manifest scope: **' + count + ' manifest-tracked entries / ' + bytes + ' bytes**, excluding the manifest self-entry plus the declared delivery-scope exclusions (' + exclusions + ').',
    '- Counters are machine-generated from the tracked source tree by `scripts/release-provenance.js`; hand-typed counters are not permitted in this document.',
    '- Production migration chain: **' + chain + '**; product version: **' + version + '**.'
  ].join('\n');

  const receiptBlock = [
    '- Generated manifest scope on this source tree: **' + count + ' manifest-tracked entries / ' + bytes + ' bytes** (the manifest self-entry is excluded from the byte total).',
    '- Production migration chain: **' + chain + '**; product version: **' + version + '**.',
    '- Rendered from `' + MANIFEST_REL + '` by `scripts/release-provenance.js`; `--check` fails closed on any drift between the tree, the manifest and this document.'
  ].join('\n');

  const finalStatusBlock = [
    '- Generated manifest scope: **' + count + ' files / ' + bytes + ' bytes** (the manifest self-entry is excluded from the byte total); migration chain **' + chain + '**; version **' + version + '**.',
    '- This block is machine-rendered from the source tree by `scripts/release-provenance.js`; `--check` fails closed on drift, so these counters cannot diverge from the shipped tree.'
  ].join('\n');

  // Marker documents are re-rendered from their current text so the generated
  // block is swapped in place and the surrounding narrative prose is preserved.
  const docs = {};
  docs[BUYER_DATA_REL] = renderBuyerData({ readText: readSource }, totals, migration, version);
  docs[MARKER_DOCS[0]] = replaceGeneratedBlock(readSource(MARKER_DOCS[0]), 'manifest-scope', statusBlock);
  docs[MARKER_DOCS[1]] = replaceGeneratedBlock(readSource(MARKER_DOCS[1]), 'release-provenance', receiptBlock);
  docs[MARKER_DOCS[2]] = replaceGeneratedBlock(readSource(MARKER_DOCS[2]), 'release-provenance', finalStatusBlock);
  docs['docs/PACKAGE_CONTENTS_SHA256SUMS.txt'] = renderChecksums(totals);

  return docs;
}

function defaultSourceReader(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function renderBuyerData(workspace, totals, migration, version) {
  const data = JSON.parse(workspace.readText(BUYER_DATA_REL));
  const catalog = JSON.parse(workspace.readText(CAPABILITY_PARITY_REL));
  const capabilities = Array.isArray(catalog.capabilities) ? catalog.capabilities : [];
  // Publish the exact canonical registry, not only aggregate counts. Keeping
  // both facts and rows derived from the same source prevents silent omissions.
  data.capabilities = capabilities;
  const statusCounts = {};
  for (const capability of capabilities) {
    const status = String(capability && capability.status || 'UNKNOWN');
    statusCounts[status] = Number(statusCounts[status] || 0) + 1;
  }

  // All buyer-visible summaries must be generated from the canonical registry, not a stale snapshot.
  data.total = capabilities.length;
  data.byStatus = statusCounts;
  data.notReal = capabilities.length - Number(statusCounts.REAL || 0);
  data.features = capabilities.map(capability => ({ id: capability.id, status: capability.status }));

  const localeManifest = JSON.parse(workspace.readText('i18n/manifest-114.generated.json'));
  const localeRows = Array.isArray(localeManifest.locales) ? localeManifest.locales : [];
  const localeStatusCounts = {};
  for (const locale of localeRows) {
    const status = String(locale && locale.status || 'UNKNOWN');
    localeStatusCounts[status] = Number(localeStatusCounts[status] || 0) + 1;
  }
  const localeTotal = Number(localeManifest.localeCount || localeRows.length);
  const localeVerified = Number(localeStatusCounts.verified || 0);
  const localeMachineDraft = Number(localeStatusCounts['machine-draft'] || 0);
  const localeUntranslated = Number(localeStatusCounts.untranslated || 0);
  const humanCertified = Number(localeManifest.officialAdoption && localeManifest.officialAdoption.humanCertifiedLocaleCount || 0);
  data.locales = {
    ...(data.locales && typeof data.locales === 'object' ? data.locales : {}),
    total: localeTotal,
    verified: localeVerified,
    machineDraft: localeMachineDraft,
    untranslated: localeUntranslated,
    other: Math.max(0, localeTotal - localeVerified - localeMachineDraft - localeUntranslated),
    humanCertified,
    note: 'humanCertified stays 0 until a native-speaker sign-off file exists'
  };
  data.provenance = {
    ...(data.provenance && typeof data.provenance === 'object' ? data.provenance : {}),
    repository: 'https://github.com/mohamedsamir113377-bit/GPON-Orchestrator.git',
    branch: 'NOT_BOUND_IN_GENERATOR',
    commit: null,
    sourceFile: CAPABILITY_PARITY_REL,
    sourceSha256: sha256(Buffer.from(workspace.readText(CAPABILITY_PARITY_REL), 'utf8'))
  };

  const serverSource = workspace.readText('services/api/src/server.js');
  const metaMatch = serverSource.match(/endpoints:\s*\[([\s\S]*?)\n\s*\]\n\s*\}/);
  const metaEndpointEntries = metaMatch
    ? (metaMatch[1].match(/'[^']+'/g) || []).length
    : Number(data.facts && data.facts.v1MetaEndpointEntries || 0);

  const facts = data.facts && typeof data.facts === 'object' ? data.facts : {};
  const tracked = Array.isArray(totals && totals.files) ? totals.files : [];
  const sharedPackageManifests = tracked.filter(rel => /^packages\/[^/]+\/package\.json$/.test(rel)).length;
  const servicePackageManifests = tracked.filter(rel => /^services\/[^/]+\/package\.json$/.test(rel)).length;
  const totalNodeTestFiles = tracked.filter(rel =>
    /^(?:packages|services|apps)\/[^/]+\/test\/[^/]+\.test\.js$/.test(rel)
  ).length;
  const buyerContractTestFiles = tracked.filter(rel => /(?:^|\/)staticWebContracts\.test\.js$/.test(rel)).length;
  const runtimeContract = JSON.parse(workspace.readText('config/runtime-environment-contract.v1.json'));
  const databaseTarget = 'PostgreSQL ' + String(runtimeContract.postgresql.requiredMajor) + ' + PostGIS ' + String(runtimeContract.postgresql.postgis);
  data.generatedBy = 'scripts/release-provenance.js';
  data.generatedFrom = {
    ...(data.generatedFrom && typeof data.generatedFrom === 'object' ? data.generatedFrom : {}),
    sourceAuthority: 'CURRENT_TRACKED_SOURCE_TREE',
    sourceBranch: 'NOT_BOUND_IN_GENERATOR',
    sourceCommit: null,
    currentBranch: 'NOT_BOUND_IN_GENERATOR',
    currentBranchAtUpdate: 'NOT_BOUND_IN_GENERATOR'
  };
  data.facts = {
    ...facts,
    capabilityTotal: capabilities.length,
    statusCounts,
    verifiedLocaleCount: localeVerified,
    localeCatalogFiles: localeTotal,
    machineDraftLocaleCount: localeMachineDraft,
    untranslatedLocaleCount: localeUntranslated,
    structuralPlaceholders: Math.max(0, localeTotal - localeVerified),
    numberedMigrations: migration.migrationFiles.length,
    migrationRange: '001-' + migration.highestMigration,
    workspacePackageManifests: sharedPackageManifests + servicePackageManifests + 1,
    sharedPackageManifests,
    servicePackageManifests,
    productNodeTestFiles: totalNodeTestFiles - buyerContractTestFiles,
    buyerContractTestFiles,
    totalNodeTestFiles,
    v1MetaEndpointEntries: metaEndpointEntries,
    packageVersion: version,
    minimumNode: workspace.readText('.nvmrc').trim(),
    // Fail-closed constant: the commercial release ships with PRODUCTION_HOLD=true
    // and no live buyer/runtime attestation, so published buyer data must never
    // claim production certification. Flip only through the runtime attestation gate.
    productionCertification: false,
    databaseTarget,
    packageStructureLabel: sharedPackageManifests + ' shared package manifests + ' + servicePackageManifests + ' service manifests + 1 root workspace manifest'
  };
  data.migrationRange = '001-' + migration.highestMigration;
  return JSON.stringify(data, null, 2) + '\n';
}


function renderChecksums(totals) {
  const lines = [
    '# Key packaged deliverables — SHA-256',
    '# GENERATED by scripts/release-provenance.js — do not edit by hand.'
  ];
  for (const rel of KEY_DELIVERABLES) {
    const digest = totals.hashes[rel];
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) {
      throw new Error('Key deliverable missing from the manifest scope: ' + rel);
    }
    lines.push(digest + '  ' + rel);
  }
  return lines.join('\n') + '\n';
}

/**
 * Build the manifest text, preserving release-controlled metadata and only
 * replacing what is derived from the tree.
 */
function buildManifestText(workspace, totals, migration, version) {
  const manifest = JSON.parse(workspace.readText(MANIFEST_REL));

  manifest.packageVersion = version;
  manifest.databaseMigrations = '001-' + migration.highestMigration;
  manifest.fileCount = totals.fileCount;
  manifest.bytes = totals.bytes;
  manifest.sha256ByFile = totals.hashes;
  manifest.generatedBy = 'scripts/release-provenance.js';
  // updateDate is release-controlled metadata; generation must never
  // manufacture or overwrite it, and must not read wall-clock time.

  const migrationNotePrefix = 'Migration integrity is statically verified against sql/migrations/001-';
  manifest.notes = (manifest.notes || []).filter(note =>
    !(typeof note === 'string' && note.startsWith(migrationNotePrefix))
  );
  manifest.notes.push(
    migrationNotePrefix + migration.highestMigration +
    ', PRODUCTION_MIGRATIONS.txt, PRODUCTION_MIGRATIONS.sha256, and the canonical RLS inventory.'
  );
  manifest.notes.push(
    'Release provenance is generated from the tracked source tree by scripts/release-provenance.js: ' +
    'manifest counters, per-file SHA-256 values, the migration range and the counters quoted in the release ' +
    'documents plus the buyer-data inventory all come from one generator, and scripts/release-provenance.js --check fails closed on drift.'
  );
  manifest.notes = [...new Set(manifest.notes.filter(note => typeof note === 'string'))];

  return JSON.stringify(manifest, null, 2) + '\n';
}

/**
 * Iterate render -> recompute until the release documents stop changing.
 * The documents quote the totals and are hashed into the manifest, so a single
 * pass is not necessarily a fixed point. Bounded and deterministic.
 */
function renderToFixedPoint(workspace, policy, migration, version) {
  let totals = null;
  let docs = null;
  let converged = false;

  for (let pass = 0; pass < MAX_RENDER_PASSES; pass += 1) {
    totals = computeTotals(workspace, policy);
    docs = renderDocs(totals, migration, version, policy, rel => workspace.readText(rel));

    const changed = Object.entries(docs)
      .filter(([rel, content]) => workspace.readText(rel) !== content);

    if (!changed.length) {
      converged = true;
      break;
    }
    for (const [rel, content] of changed) workspace.stage(rel, content);
  }

  if (!converged) {
    throw new Error('Release provenance rendering did not converge within ' + MAX_RENDER_PASSES + ' passes.');
  }

  return { totals: computeTotals(workspace, policy), docs };
}

/** Pure drift detection used by `--check` and by the generator unit tests. */
function detectDrift(workspace, policy, migration, version) {
  const { totals, docs } = renderToFixedPoint(workspace, policy, migration, version);
  const drift = [];

  for (const [rel, expected] of Object.entries(docs)) {
    const actual = workspace.readCommitted(rel);
    if (actual !== expected) {
      drift.push({ file: rel, kind: 'generated-document-drift' });
    }
  }

  const expectedManifest = buildManifestText(workspace, totals, migration, version);
  const actualManifest = workspace.readCommitted(MANIFEST_REL);
  if (actualManifest !== expectedManifest) {
    const actual = JSON.parse(actualManifest);
    const expected = JSON.parse(expectedManifest);
    const manifestDriftStart = drift.length;
    for (const field of ['fileCount', 'bytes', 'databaseMigrations', 'packageVersion']) {
      if (actual[field] !== expected[field]) {
        drift.push({
          file: MANIFEST_REL,
          kind: 'manifest-counter-drift',
          field,
          manifest: actual[field],
          tree: expected[field]
        });
      }
    }
    const declared = actual.sha256ByFile || {};
    const tree = expected.sha256ByFile || {};
    const names = new Set([...Object.keys(declared), ...Object.keys(tree)]);
    for (const name of [...names].sort()) {
      if (declared[name] !== tree[name]) {
        drift.push({
          file: MANIFEST_REL,
          kind: 'manifest-hash-drift',
          entry: name,
          manifest: declared[name] === undefined ? '(absent)' : declared[name],
          tree: tree[name] === undefined ? '(absent)' : tree[name]
        });
      }
    }
    // If counters and per-file hashes match, compare every remaining field
    // semantically. Only JSON formatting/object-key order is ignored; changed
    // notes, truth boundaries, metadata, or any other value remain a hard fail.
    if (!sameJsonValue(actual, expected) && drift.length === manifestDriftStart) {
      drift.push({ file: MANIFEST_REL, kind: 'manifest-content-drift' });
    }
  }

  return { drift, totals };
}

function runProvenance({ check = false, quiet = false } = {}) {
  const policy = readPolicy();
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const workspace = makeWorkspace();
  const migration = readMigrationState(workspace);

  if (check) {
    const { drift, totals } = detectDrift(workspace, policy, migration, version);
    if (drift.length) {
      console.error('RELEASE_PROVENANCE_DRIFT: the committed release artifacts no longer match the source tree.');
      for (const item of drift) {
        if (item.kind === 'manifest-counter-drift') {
          console.error('  - ' + item.file + ' [' + item.field + ']: committed=' + item.manifest + ' tree=' + item.tree);
        } else if (item.kind === 'manifest-hash-drift') {
          console.error('  - ' + item.file + ' [sha256 ' + item.entry + ']: committed=' + item.manifest + ' tree=' + item.tree);
        } else {
          console.error('  - ' + item.file + ' [' + item.kind + ']');
        }
      }
      console.error('Run: node scripts/release-provenance.js');
      process.exitCode = 1;
      return { ok: false, drift, totals };
    }
    if (!quiet) {
      console.log('Release provenance check passed: ' + totals.fileCount + ' files, ' + totals.bytes +
        ' bytes, migrations ' + migration.chain + ' — manifest and release documents match the source tree.');
    }
    return { ok: true, drift: [], totals };
  }

  const { totals, docs } = renderToFixedPoint(workspace, policy, migration, version);
  for (const [rel, content] of Object.entries(docs)) workspace.stage(rel, content);
  const manifestText = buildManifestText(workspace, totals, migration, version);
  workspace.stage(MANIFEST_REL, manifestText);
  workspace.commit();

  if (!quiet) {
    console.log('Release provenance generated: ' + totals.fileCount + ' files, ' + totals.bytes +
      ' bytes, migrations ' + migration.chain + ', ' + GENERATED_DOCS.length + ' release documents rendered.');
  }
  return { ok: true, totals, docs };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  try {
    runProvenance({ check: args.includes('--check') });
  } catch (error) {
    console.error('RELEASE_PROVENANCE_FAILED: ' + (error && error.message ? error.message : String(error)));
    process.exitCode = 1;
  }
}

module.exports = {
  ROOT,
  MANIFEST_REL,
  SELF_MARKER,
  GENERATED_DOCS,
  MARKER_DOCS,
  BUYER_DATA_REL,
  KEY_DELIVERABLES,
  sha256,
  readPolicy,
  isExcluded,
  walkFiles,
  makeWorkspace,
  computeTotals,
  readMigrationState,
  replaceGeneratedBlock,
  renderDocs,
  renderChecksums,
  buildManifestText,
  renderToFixedPoint,
  detectDrift,
  runProvenance
};
