#!/usr/bin/env node
'use strict';

/**
 * Static adversarial database audit — source + migration ledgers only.
 * productionCertification is always false here; runtime privileges require live PostgreSQL.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const MIG_DIR = path.join(ROOT, 'sql', 'migrations');
const MANIFEST = path.join(MIG_DIR, 'PRODUCTION_MIGRATIONS.txt');
const CHECKSUMS = path.join(MIG_DIR, 'PRODUCTION_MIGRATIONS.sha256');
const EXTRA_CHECKSUMS = path.join(MIG_DIR, 'PRODUCTION_MIGRATIONS.extra.sha256');
const INVENTORY = path.join(ROOT, 'config', 'rls-tenant-sensitive-inventory.json');

function fail(message, details) {
  console.error(JSON.stringify({ ok: false, error: message, details: details || null }, null, 2));
  process.exitCode = 1;
  throw new Error(message);
}

function readLines(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/);
}

function readText(rel) {
  const full = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return fs.readFileSync(full, 'utf8');
}

function count(text, re) {
  return (text.match(re) || []).length;
}

function migrationFiles() {
  return fs.readdirSync(MIG_DIR).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
}

function verifyTenantContainmentClosure() {
  const file = '121_tenant_containment_closure.sql';
  const text = fs.readFileSync(path.join(MIG_DIR, file), 'utf8');
  const policies = [
    'network_cards_scope',
    'technician_role_assignments_scope',
    'ticket_worker_assignments_scope',
    'splice_records_scope'
  ];
  for (const policy of policies) {
    const match = text.match(new RegExp('CREATE\\s+POLICY\\s+' + policy + '[\\s\\S]*?\\);', 'i'));
    if (!match) fail('TENANT_CONTAINMENT_POLICY_MISSING', { file, policy });
    if (/\bOR\s+fiberos_has_any_role\s*\(/i.test(match[0])) {
      fail('TENANT_CONTAINMENT_ROLE_ONLY_OR_BRANCH', { file, policy });
    }
    if (
      !/tenant_id\s+IN\s*\(\s*SELECT\s+tenant_id\s+FROM\s+user_preferences/i.test(match[0]) &&
      !/a\.tenant_id\s+IN\s*\(\s*SELECT\s+tenant_id\s+FROM\s+user_preferences/i.test(match[0])
    ) {
      fail('TENANT_CONTAINMENT_MEMBERSHIP_MISSING', { file, policy });
    }
  }
  return { file, policies, roleOnlyOrBranches: 0, tenantMembershipBound: true };
}

function verifySyncIngestExecutePrivilegeClosure() {
  const file = readText('sql/migrations/122_sync_ingest_execute_privilege_closure.sql');
  if (!file) fail('migration122SyncIngestExecutePrivilegeClosure: missing migration 122');
  const normalized = file.replace(/\s+/g, ' ');
  if (
    !/REVOKE ALL ON FUNCTION public\.fiberos_ingest_sync_batch\(jsonb, jsonb\)\s+FROM PUBLIC,\s*anon,\s*authenticated,\s*fiberos_runtime,\s*fiberos_worker,\s*fiberos_app/i.test(
      normalized
    )
  ) {
    fail('migration122SyncIngestExecutePrivilegeClosure: sync-ingest EXECUTE is not revoked from direct/client/runtime roles');
  }
  if (
    !/GRANT EXECUTE ON FUNCTION public\.fiberos_ingest_sync_batch\(jsonb, jsonb\)\s+TO fiberos_app/i.test(normalized)
  ) {
    fail('migration122SyncIngestExecutePrivilegeClosure: sync-ingest EXECUTE is not restricted to fiberos_app');
  }
  const migration120 = readText('sql/migrations/120_operational_cycle_execution_closure.sql');
  if (!migration120) fail('migration122SyncIngestExecutePrivilegeClosure: missing migration 120');
  if (
    !/identity and role are[\s\S]*derived from the verified database session and never from caller JSON/i.test(
      migration120
    )
  ) {
    fail('migration122SyncIngestExecutePrivilegeClosure: migration 120 trusted-session identity contract changed unexpectedly');
  }
  if (!/auth\.uid\(\)[\s\S]*auth\.jwt\(\)->'app_metadata'->>'role'/i.test(migration120)) {
    fail('migration122SyncIngestExecutePrivilegeClosure: migration 120 no longer derives actor/role from the verified session');
  }
  if (/p_principal\s*->>\s*'role'/i.test(migration120)) {
    fail('migration122SyncIngestExecutePrivilegeClosure: migration 120 reads the application role from caller-supplied JSON');
  }
  return { file: '122_sync_ingest_execute_privilege_closure.sql', revokeClosed: true, grantAppOnly: true };
}

function extractSecurityDefiners(text, file) {
  const out = [];
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:[a-zA-Z_][\w$]*\.)?[a-zA-Z_][\w$]*)\s*\(/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    // Header only: from CREATE FUNCTION through the first AS $$ / AS $tag$ / LANGUAGE ... AS
    const tail = text.slice(start, start + 1200);
    const bodyStart = tail.search(/\bAS\s+\$[A-Za-z0-9_]*\$/i);
    const header = bodyStart === -1 ? tail.slice(0, 400) : tail.slice(0, bodyStart);
    if (!/SECURITY\s+DEFINER/i.test(header)) continue;
    const hasSearchPath = /SET\s+search_path\s*(?:=|TO)/i.test(header);
    out.push({
      file,
      function: match[1],
      hasSearchPath,
      securityDefiner: true
    });
  }
  return out;
}

function scanSensitiveDml(root, sensitiveTables) {
  const roots = [
    path.join(root, 'services', 'api', 'src'),
    path.join(root, 'packages'),
    path.join(root, 'services', 'worker', 'src'),
    path.join(root, 'services', 'ai', 'src'),
    path.join(root, 'services', 'gis', 'src')
  ].filter(fs.existsSync);
  const out = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git') continue;
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.(js|ts)$/.test(name)) {
        const rel = path.relative(root, full).split(path.sep).join('/');
        const lines = readLines(full);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!/\b(?:insert\s+into|update|delete\s+from)\b/i.test(line)) continue;
          for (const table of sensitiveTables) {
            if (new RegExp('\\b' + table + '\\b', 'i').test(line)) {
              out.push({ file: rel, line: i + 1, table, text: line.trim().slice(0, 280) });
            }
          }
        }
      }
    }
  }
  for (const r of roots) walk(r);
  return out;
}

const tenantContainmentClosure = verifyTenantContainmentClosure();
const syncIngestClosure = verifySyncIngestExecutePrivilegeClosure();

const listed = readLines(MANIFEST).map((x) => x.trim()).filter((x) => x && !x.startsWith('#'));
const actual = migrationFiles();
const expected = Array.from({ length: actual.length }, (_, i) => String(i + 1).padStart(3, '0'));
const numbers = actual.map((f) => f.slice(0, 3));
if (listed.length !== actual.length) {
  fail('MIGRATION_MANIFEST_COUNT_MISMATCH', { manifestCount: listed.length, expected: actual.length });
}
if (actual.length < 1) fail('MIGRATION_FILE_COUNT_MISMATCH', { actualCount: actual.length, expected: '>=1' });
if (JSON.stringify(listed) !== JSON.stringify(actual)) {
  fail('MIGRATION_MANIFEST_FILESET_MISMATCH', {
    missing: listed.filter((x) => !actual.includes(x)),
    unexpected: actual.filter((x) => !listed.includes(x))
  });
}
if (JSON.stringify(numbers) !== JSON.stringify(expected)) {
  fail('MIGRATION_SEQUENCE_MISMATCH', { numbers, expected });
}

const checksums = new Map();
for (const file of [CHECKSUMS, EXTRA_CHECKSUMS]) {
  if (!fs.existsSync(file)) continue;
  for (const line of readLines(file).map((x) => x.trim()).filter(Boolean)) {
    const m = /^([a-f0-9]{64})\s+(\S+)$/.exec(line);
    if (!m) fail('INVALID_MIGRATION_CHECKSUM_LINE', { line });
    checksums.set(m[2], m[1]);
  }
}
if (checksums.size !== actual.length) {
  fail('MIGRATION_CHECKSUM_COUNT_MISMATCH', { checksumCount: checksums.size, expected: actual.length });
}

const inventory = JSON.parse(fs.readFileSync(INVENTORY, 'utf8'));
const sensitive = inventory.tables.filter((x) => x && x.tenantSensitive).map((x) => x.table).sort();
if (inventory.migrationCount !== actual.length || inventory.source.migrationCount !== actual.length) {
  fail('INVENTORY_MIGRATION_COUNT_MISMATCH', {
    inventoryMigrationCount: inventory.migrationCount,
    sourceMigrationCount: inventory.source.migrationCount
  });
}

const stats = [];
const securityDefiners = [];
const regressionSignals = [];
for (const file of actual) {
  const text = fs.readFileSync(path.join(MIG_DIR, file), 'utf8');
  const digest = crypto.createHash('sha256').update(text).digest('hex');
  if (digest !== checksums.get(file)) {
    fail('MIGRATION_CHECKSUM_MISMATCH', { file, expected: checksums.get(file), actual: digest });
  }
  securityDefiners.push(...extractSecurityDefiners(text, file));
  const stat = {
    file,
    bytes: Buffer.byteLength(text),
    securityDefiner: count(text, /\bSECURITY\s+DEFINER\b/gi),
    searchPath: count(text, /\bSET\s+search_path\s*(?:=|TO)/gi),
    grant: count(text, /\bGRANT\b/gi),
    revoke: count(text, /\bREVOKE\b/gi),
    owner: count(text, /\bALTER\s+(?:FUNCTION|TABLE|SEQUENCE|SCHEMA)\b[\s\S]{0,150}\bOWNER\s+TO\b/gi),
    dml: {
      insert: count(text, /\bINSERT\s+INTO\b/gi),
      update: count(text, /\bUPDATE\s+[A-Za-z_"]/gi),
      delete: count(text, /\bDELETE\s+FROM\b/gi),
      truncate: count(text, /\bTRUNCATE\b/gi)
    },
    rls: count(text, /\b(?:ENABLE|FORCE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY\b/gi),
    trigger: count(text, /\bCREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\b/gi)
  };
  stats.push(stat);
  if (
    /\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i.test(text) &&
    !/\b(?:ENABLE|FORCE)\s+ROW\s+LEVEL\s+SECURITY\b/i.test(text)
  ) {
    regressionSignals.push({ file, signal: 'DISABLE_RLS_WITHOUT_REENABLE_IN_SAME_MIGRATION' });
  }
  if (/\bDROP\s+(?:POLICY|TRIGGER)\b/i.test(text)) {
    regressionSignals.push({ file, signal: 'POLICY_OR_TRIGGER_REPLACEMENT_REVIEW_REQUIRED' });
  }
}

const definerWithoutPath = securityDefiners.filter((x) => !x.hasSearchPath);
if (definerWithoutPath.length) {
  fail('SECURITY_DEFINER_WITHOUT_SEARCH_PATH', definerWithoutPath.slice(0, 25));
}

const sensitiveDml = scanSensitiveDml(ROOT, sensitive);
const grantSignals = [];
for (const file of actual) {
  for (const [i, line] of readLines(path.join(MIG_DIR, file)).entries()) {
    if (
      /\bGRANT\s+(?:INSERT|UPDATE|DELETE|TRUNCATE|ALL|REFERENCES)\b/i.test(line) &&
      /\bTO\s+(?:authenticated|fiberos_app|fiberos_runtime|fiberos_worker)\b/i.test(line)
    ) {
      grantSignals.push({ file, line: i + 1, text: line.trim() });
    }
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      evidenceClass: 'STATIC_SOURCE_ADVERSARIAL_DB_AUDIT',
      productionCertification: false,
      migrationChain: {
        count: actual.length,
        first: actual[0],
        last: actual[actual.length - 1],
        checksumsVerified: true
      },
      inventory: {
        migrationCount: inventory.migrationCount,
        tenantSensitiveTableCount: sensitive.length
      },
      totals: {
        bytes: stats.reduce((n, x) => n + x.bytes, 0),
        securityDefiner: stats.reduce((n, x) => n + x.securityDefiner, 0),
        searchPath: stats.reduce((n, x) => n + x.searchPath, 0),
        grants: stats.reduce((n, x) => n + x.grant, 0),
        revokes: stats.reduce((n, x) => n + x.revoke, 0),
        directDmlStatements: stats.reduce(
          (n, x) => n + x.dml.insert + x.dml.update + x.dml.delete + x.dml.truncate,
          0
        )
      },
      securityDefiners: securityDefiners.slice(0, 50),
      sensitiveDirectDml: sensitiveDml.slice(0, 50),
      grantSignals: grantSignals.slice(0, 50),
      regressionSignals: regressionSignals.slice(0, 50),
      tenantContainmentClosure,
      syncIngestClosure,
      note: 'Static evidence only; effective PostgreSQL privileges and concurrency require runtime proof.'
    },
    null,
    2
  )
);
