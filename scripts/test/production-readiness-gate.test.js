'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  postgresVersionNumber,
  postgresVersionAtLeast,
  normalizedHttpsOrigin,
  validateTlsProbeTarget,
  tlsStatusAccepted,
  resolveReadinessDatabaseUrl,
  APPLICATION_REQUIRED_TABLES,
  loadExpectedMigrationLedger,
  validateAppliedMigrationHistory,
  migrationHistoryFingerprint,
  validateAppliedMigrationAttestation,
} = require('../production-readiness-gate');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('PostgreSQL security baseline rejects 18.5 and accepts 18.6+', () => {
  assert.equal(postgresVersionNumber('18.6'), 180006);
  assert.equal(postgresVersionAtLeast(180005, '18.6'), false);
  assert.equal(postgresVersionAtLeast(180006, '18.6'), true);
  assert.equal(postgresVersionAtLeast(180007, '18.6'), true);
  assert.equal(postgresVersionAtLeast(170999, '18.6'), false);
});

test('TLS probe must target the exact expected HTTPS origin', () => {
  const valid = validateTlsProbeTarget(
    'https://api.example.invalid/health',
    'https://api.example.invalid'
  );
  assert.equal(valid.ok, true);
  assert.equal(valid.expectedOrigin, 'https://api.example.invalid');

  const mismatch = validateTlsProbeTarget(
    'https://other.example.invalid/health',
    'https://api.example.invalid'
  );
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error, 'TLS_PROBE_ORIGIN_MISMATCH');
});

test('TLS probe rejects insecure or credential-bearing targets', () => {
  assert.deepEqual(
    validateTlsProbeTarget('http://api.example.invalid/health', 'https://api.example.invalid'),
    { ok: false, error: 'TLS_PROBE_MUST_USE_HTTPS' }
  );
  assert.deepEqual(
    validateTlsProbeTarget('https://user:pass@api.example.invalid/health', 'https://api.example.invalid'),
    { ok: false, error: 'TLS_PROBE_CREDENTIALS_FORBIDDEN' }
  );
  assert.throws(
    () => normalizedHttpsOrigin('https://api.example.invalid/health', 'FIBEROS_TLS_EXPECTED_ORIGIN_INVALID'),
    /FIBEROS_TLS_EXPECTED_ORIGIN_INVALID/
  );
});

test('TLS readiness accepts only 2xx responses and rejects redirects', () => {
  for (const status of [200, 201, 204, 299]) assert.equal(tlsStatusAccepted(status), true, String(status));
  for (const status of [301, 302, 307, 308, 400, 500]) assert.equal(tlsStatusAccepted(status), false, String(status));
});


test('readiness gate resolves its database target with the canonical URL contract', () => {
  const url = 'postgres://fiberos_runtime:secret@db.example:5432/fiberos';
  const result = resolveReadinessDatabaseUrl({ DATABASE_URL: url });
  assert.equal(result.configured, true);
  assert.equal(result.source, 'INLINE');
  assert.equal(result.url, url);
});

test('readiness gate fails closed when inline and mounted database secrets conflict', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fiberos-readiness-db-'));
  try {
    const secretFile = path.join(dir, 'database-url');
    fs.writeFileSync(secretFile, 'postgres://fiberos_runtime:different@other.example:5432/fiberos\n', { mode: 0o600 });
    assert.throws(
      () => resolveReadinessDatabaseUrl({
        DATABASE_URL: 'postgres://fiberos_runtime:secret@db.example:5432/fiberos',
        DATABASE_URL_FILE: secretFile
      }),
      error => error.code === 'DATABASE_URL_AND_DATABASE_URL_FILE_BOTH_SET_CONFLICT' &&
        !error.message.includes('secret') && !error.message.includes('different')
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readiness gate reports a missing database secret without claiming a connection', () => {
  const result = resolveReadinessDatabaseUrl({});
  assert.equal(result.configured, false);
  assert.equal(result.code, 'DATABASE_URL_OR_DATABASE_URL_FILE_REQUIRED');
  assert.equal(result.url, '');
});

test('readiness gate rejects malformed database URLs without echoing credentials', () => {
  assert.throws(
    () => resolveReadinessDatabaseUrl({ DATABASE_URL: 'postgres://fiberos_runtime:do-not-leak@db.example:5432' }),
    error => error.code === 'DATABASE_URL_DATABASE_MISSING' && !error.message.includes('do-not-leak')
  );
});


test('production readiness source migration ledger is contiguous and checksum-verified', () => {
  const root = path.resolve(__dirname, '../..');
  const ledger = loadExpectedMigrationLedger(root);
  // Derive the expected population from the on-disk migration files so this guard
  // tracks the CURRENT chain instead of a frozen historical snapshot; this also
  // cross-checks that the committed ledger exactly mirrors the files on disk.
  const onDisk = fs.readdirSync(path.join(root, 'sql/migrations'))
    .filter((n) => /^\d{3}_.+\.sql$/.test(n) && n !== '000_local_auth_stubs.sql')
    .sort();
  assert.ok(onDisk.length > 0, 'no production migrations on disk');
  assert.equal(ledger.migrations.length, onDisk.length);
  assert.equal(ledger.highestMigration, onDisk[onDisk.length - 1].slice(0, 3));
  assert.equal(ledger.migrations[0].migration_name, onDisk[0]);
  assert.equal(ledger.migrations.at(-1).migration_name, onDisk[onDisk.length - 1]);
  assert.equal(ledger.migrations.every(row => /^[a-f0-9]{64}$/.test(row.sha256)), true);
});

test('migration 186 installs a tightly scoped live attestation and never exposes raw migration history', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../../sql/migrations/186_migration_history_attestation.sql'), 'utf8');
  assert.ok(migration.includes('CREATE OR REPLACE FUNCTION public.fiberos_migration_history_attestation()'));
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = pg_catalog, public/);
  assert.ok(migration.includes('GRANT EXECUTE ON FUNCTION public.fiberos_migration_history_attestation() TO fiberos_runtime'));
  assert.ok(migration.includes('acl.grantee = 0'));
  assert.match(migration, /FIBEROS_MIGRATION_HISTORY_RAW_READ_PRIVILEGE_LEAK/);
});

test('database readiness rejects a blank database when app schema and migration history are absent', () => {
  const expected = [
    { migration_name: '001_extensions.sql', sha256: 'a'.repeat(64) },
    { migration_name: '002_identity_technicians.sql', sha256: 'b'.repeat(64) }
  ];
  const result = validateAppliedMigrationHistory(expected, null, APPLICATION_REQUIRED_TABLES);
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes('APP_MIGRATION_HISTORY_MISSING'));
  assert.ok(result.failures.includes('APP_SCHEMA_TABLES_MISSING'));
  assert.equal(result.expectedMigrationCount, 2);
  assert.equal(result.appliedMigrationCount, 0);
});

test('database readiness accepts only the exact migration names and hashes', () => {
  const expected = [
    { migration_name: '001_extensions.sql', sha256: 'a'.repeat(64) },
    { migration_name: '002_identity_technicians.sql', sha256: 'b'.repeat(64) }
  ];
  const result = validateAppliedMigrationHistory(expected, expected.map(row => ({ ...row })), []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
  assert.equal(result.expectedMigrationCount, 2);
  assert.equal(result.appliedMigrationCount, 2);
});

test('database readiness rejects missing migrations', () => {
  const expected = [
    { migration_name: '001_extensions.sql', sha256: 'a'.repeat(64) },
    { migration_name: '002_identity_technicians.sql', sha256: 'b'.repeat(64) }
  ];
  const result = validateAppliedMigrationHistory(expected, [expected[0]], []);
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes('APP_MIGRATIONS_MISSING'));
  assert.deepEqual(result.missingMigrations, ['002_identity_technicians.sql']);
});

test('database readiness rejects extra migrations not present in source', () => {
  const expected = [{ migration_name: '001_extensions.sql', sha256: 'a'.repeat(64) }];
  const applied = [{ ...expected[0] }, { migration_name: '999_unreviewed.sql', sha256: 'f'.repeat(64) }];
  const result = validateAppliedMigrationHistory(expected, applied, []);
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes('APP_MIGRATIONS_UNEXPECTED'));
  assert.deepEqual(result.unexpectedMigrations, ['999_unreviewed.sql']);
});

test('database readiness rejects altered checksums even when every migration name exists', () => {
  const expected = [{ migration_name: '001_extensions.sql', sha256: 'a'.repeat(64) }];
  const applied = [{ migration_name: '001_extensions.sql', sha256: 'c'.repeat(64) }];
  const result = validateAppliedMigrationHistory(expected, applied, []);
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes('APP_MIGRATION_CHECKSUM_MISMATCH'));
  assert.deepEqual(result.checksumMismatches, ['001_extensions.sql']);
});

test('database readiness rejects missing mandatory application tables', () => {
  const expected = [{ migration_name: '001_extensions.sql', sha256: 'a'.repeat(64) }];
  const result = validateAppliedMigrationHistory(expected, [{ ...expected[0] }], ['tickets', 'tenants']);
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes('APP_SCHEMA_TABLES_MISSING'));
  assert.deepEqual(result.missingRequiredTables, ['tenants', 'tickets']);
});

test('migration ledger attestation fingerprint is deterministic and order-independent', () => {
  const expected = [
    { migration_name: '002_identity_technicians.sql', sha256: 'b'.repeat(64) },
    { migration_name: '001_extensions.sql', sha256: 'a'.repeat(64) }
  ];
  assert.match(migrationHistoryFingerprint(expected), /^[a-f0-9]{64}$/);
  assert.equal(migrationHistoryFingerprint(expected), migrationHistoryFingerprint(expected.slice().reverse()));
});

test('database readiness accepts a matching constrained migration-ledger attestation', () => {
  const expected = [
    { migration_name: '001_extensions.sql', sha256: 'a'.repeat(64) },
    { migration_name: '002_identity_technicians.sql', sha256: 'b'.repeat(64) }
  ];
  const result = validateAppliedMigrationAttestation(expected, {
    migration_count: '2',
    latest_migration: '002_identity_technicians.sql',
    ledger_sha256: migrationHistoryFingerprint(expected)
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
  assert.equal(result.appliedMigrationCount, 2);
});

test('database readiness rejects altered count, head, fingerprint, or inaccessible attestation', () => {
  const expected = [
    { migration_name: '001_extensions.sql', sha256: 'a'.repeat(64) },
    { migration_name: '002_identity_technicians.sql', sha256: 'b'.repeat(64) }
  ];
  const good = {
    migration_count: '2',
    latest_migration: '002_identity_technicians.sql',
    ledger_sha256: migrationHistoryFingerprint(expected)
  };
  for (const [patch, code] of [
    [{ migration_count: '1' }, 'APP_MIGRATION_COUNT_MISMATCH'],
    [{ latest_migration: '001_extensions.sql' }, 'APP_MIGRATION_HEAD_MISMATCH'],
    [{ ledger_sha256: 'f'.repeat(64) }, 'APP_MIGRATION_FINGERPRINT_MISMATCH']
  ]) {
    const result = validateAppliedMigrationAttestation(expected, { ...good, ...patch });
    assert.equal(result.ok, false);
    assert.ok(result.failures.includes(code));
  }
  const denied = validateAppliedMigrationAttestation(expected, null, [], 'APP_MIGRATION_ATTESTATION_EXECUTE_DENIED');
  assert.equal(denied.ok, false);
  assert.ok(denied.failures.includes('APP_MIGRATION_ATTESTATION_EXECUTE_DENIED'));
});

test('runtime gate uses a narrow attestation function rather than raw ledger SELECT', () => {
  const source = fs.readFileSync(path.join(__dirname, '../production-readiness-gate.js'), 'utf8');
  const grants = fs.readFileSync(path.join(__dirname, '../../sql/bootstrap/20_runtime_role_grants.sql'), 'utf8');
  assert.match(source, /APPLICATION_REQUIRED_TABLES[\s\S]{0,80}\.map/);
  assert.match(source, /validateAppliedMigrationAttestation\([\s\S]{0,120}expectedLedger\.migrations/);
  assert.match(source, /migration_history_attestation\(\)/);
  assert.doesNotMatch(source, /SELECT migration_name, sha256 FROM public\.fiberos_migration_history/i);
  assert.match(source, /v\.session_user === 'fiberos_runtime'/);
  assert.match(grants, /CREATE OR REPLACE FUNCTION public\.fiberos_migration_history_attestation\(\)[\s\S]{0,500}SECURITY DEFINER/);
  assert.match(grants, /SET search_path = pg_catalog, public/);
  assert.match(grants, /REVOKE ALL ON FUNCTION public\.fiberos_migration_history_attestation\(\)[\s\S]{0,220}GRANT EXECUTE ON FUNCTION public\.fiberos_migration_history_attestation\(\) TO fiberos_runtime/);
});
