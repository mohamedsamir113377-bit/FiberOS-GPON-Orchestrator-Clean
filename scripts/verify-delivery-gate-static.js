#!/usr/bin/env node
'use strict';

/**
 * Static delivery-gate verifier (source + ledger only).
 * Does NOT claim PostgreSQL/RLS runtime, CI runner, or production readiness.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const failures = [];

function must(cond, msg) {
  if (!cond) failures.push(msg);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

// 1) Official gates
try {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/verify-migration-sequence.js')], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8'
  });
} catch (e) {
  failures.push('MIGRATION_SEQUENCE: ' + (e.stderr || e.stdout || e.message));
}

try {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/verify-manifest-parity.js')], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8'
  });
} catch (e) {
  failures.push('MANIFEST_PARITY: ' + (e.stderr || e.stdout || e.message));
}

try {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/verify-reality-chain-static.js')], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8'
  });
} catch (e) {
  failures.push('REALITY_CHAIN_STATIC: ' + (e.stderr || e.stdout || e.message));
}


// 2) Manifest tip vs the source migration sequence (avoid release-number drift)
const migrationFiles = fs.readdirSync(path.join(ROOT, 'sql/migrations'))
  .filter((name) => /^\d{3}_.+\.sql$/.test(name))
  .sort();
const migrationTip = migrationFiles.length ? migrationFiles[migrationFiles.length - 1].slice(0, 3) : null;
const migrationRange = migrationTip ? '001-' + migrationTip : null;
const manifest = JSON.parse(read('SALES_PACKAGE_MANIFEST.json'));
must(migrationFiles.length > 0, 'no numbered SQL migrations found');
must(manifest.databaseMigrations === migrationRange, 'manifest.databaseMigrations expected ' + migrationRange + ' got ' + manifest.databaseMigrations);
must(Number(manifest.fileCount) >= 1400, 'manifest.fileCount unexpectedly low: ' + manifest.fileCount);

// 3) Reality chain migrations present
const chainMigrations = [
  '150_evidence_vault_incident_command.sql',
  '153_canonical_operational_event_envelope.sql',
  '154_multilingual_contact_center_conversations.sql',
  '155_operational_event_evidence_links.sql',
  '156_operational_event_incident_links.sql',
  '157_contact_center_evidence_trust_guard.sql',
  '158_department_kpi_enterprise_scope.sql'
];
for (const m of chainMigrations) {
  must(exists('sql/migrations/' + m), 'missing chain migration ' + m);
}

// 4) Source modules for E2E chain links
const modules = [
  'packages/multilingual-contact-center/src/index.js',
  'packages/multilingual-contact-center/src/speechAdapterBoundary.js',
  'packages/operational-context/src/evidenceLink.js',
  'packages/operational-context/src/incidentLink.js',
  'packages/operational-context/src/trace.js',
  'services/api/src/routes/contactCenterMultilingual.js'
];
for (const m of modules) {
  must(exists(m), 'missing module ' + m);
}

// 5) Schema keywords must exist in migrations (static presence, not runtime)
const mustContain = [
  ['sql/migrations/154_multilingual_contact_center_conversations.sql', 'contact_center_conversations'],
  ['sql/migrations/154_multilingual_contact_center_conversations.sql', 'contact_center_conversation_messages'],
  ['sql/migrations/157_contact_center_evidence_trust_guard.sql', 'CC_MESSAGE_EVIDENCE_CLASS_SERVER_MANAGED'],
  ['sql/migrations/158_department_kpi_enterprise_scope.sql', 'enterprise_positions_app_scope_read'],
  ['sql/migrations/155_operational_event_evidence_links.sql', 'operational_event_evidence_links'],
  ['sql/migrations/156_operational_event_incident_links.sql', 'operational_event_incident_links'],
  ['sql/migrations/150_evidence_vault_incident_command.sql', 'evidence_vault'],
  ['packages/operational-context/src/trace.js', 'buildOperationalTrace']
];
for (const [file, needle] of mustContain) {
  must(read(file).includes(needle), file + ' missing token ' + needle);
}

// 6) Silent dialect regression guard in source
const cc = read('packages/multilingual-contact-center/src/index.js');
must(cc.includes('HUMAN_HANDOFF_REQUIRED'), 'language negotiation missing HUMAN_HANDOFF_REQUIRED');
must(cc.includes('LOCALE_NOT_IN_CATALOG_HUMAN_HANDOFF') || cc.includes('silentFallbackForbidden'), 'exact-locale policy markers missing');

// 7) RLS inventory aligned
const inv = JSON.parse(read('config/rls-tenant-sensitive-inventory.json'));
must(Number(inv.migrationCount) === migrationFiles.length, 'rls inventory migrationCount != ' + migrationFiles.length);
must(Number(inv.source && inv.source.migrationCount) === migrationFiles.length, 'rls inventory source.migrationCount != ' + migrationFiles.length);

if (failures.length) {
  console.error('DELIVERY_GATE_STATIC_FAIL');
  for (const f of failures) console.error(' - ' + f);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      gate: 'DELIVERY_GATE_STATIC',
      migrations: migrationRange,
      manifestFiles: manifest.fileCount,
      manifestBytes: manifest.bytes,
      chainModulesPresent: true,
      realityChainStatic: true,
      runtimeAdmission: 'NOT_CLAIMED',
      ciRunner: 'NOT_CLAIMED',
      postgresRls: 'NOT_CLAIMED'
    },
    null,
    2
  )
);
