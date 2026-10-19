'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveDatabaseUrl, tryResolveDatabaseUrl, validateDatabaseUrl, readSecretFile, redactDatabaseUrl, SOURCE_INLINE, SOURCE_FILE, SOURCE_AGREED } = require('../src/databaseUrl');
const { createPool, createWorkerPool, readSecretEnvValue } = require('../src');

const VALID = 'postgres://fiberos_runtime:sup3r-s3cret@db.example:5432/fiberos';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fiberos-dburl-'));
function writeSecret(name, contents) { const p = path.join(tmp, name); fs.writeFileSync(p, contents); return p; }

test('P1.1-01 DATABASE_URL only resolves from INLINE source', () => {
  const r = resolveDatabaseUrl({ DATABASE_URL: VALID });
  assert.equal(r.configured, true);
  assert.equal(r.source, SOURCE_INLINE);
  assert.equal(r.url, VALID);
  assert.equal(r.agreed, false);
});

test('P1.1-02 DATABASE_URL_FILE only resolves from FILE source', () => {
  const file = writeSecret('only.txt', VALID + '\n');
  const r = resolveDatabaseUrl({ DATABASE_URL_FILE: file });
  assert.equal(r.configured, true);
  assert.equal(r.source, SOURCE_FILE);
  assert.equal(r.url, VALID);
});

test('P1.1-03 both set with compatible values is accepted and records agreement', () => {
  const file = writeSecret('agree.txt', VALID + '\n');
  const r = resolveDatabaseUrl({ DATABASE_URL: VALID, DATABASE_URL_FILE: file });
  assert.equal(r.configured, true);
  assert.equal(r.source, SOURCE_AGREED);
  assert.equal(r.agreed, true);
  assert.equal(r.url, VALID);
});

test('P1.1-04 both set with conflicting values fails closed', () => {
  const file = writeSecret('conflict.txt', 'postgres://fiberos_runtime:other@db.other:5432/fiberos');
  const res = tryResolveDatabaseUrl({ DATABASE_URL: VALID, DATABASE_URL_FILE: file });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'DATABASE_URL_AND_DATABASE_URL_FILE_BOTH_SET_CONFLICT');
  assert.equal(res.resolution, null);
});

test('P1.1-05 missing file fails closed with NOT_FOUND', () => {
  const res = tryResolveDatabaseUrl({ DATABASE_URL_FILE: path.join(tmp, 'absent.txt') });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'DATABASE_URL_FILE_NOT_FOUND');
});

test('P1.1-06 empty file fails closed with EMPTY', () => {
  const file = writeSecret('empty.txt', '\n   \n');
  const res = tryResolveDatabaseUrl({ DATABASE_URL_FILE: file });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'DATABASE_URL_FILE_EMPTY');
});

test('P1.1-07 unreadable file fails closed (mode 000)', () => {
  const file = writeSecret('unreadable.txt', VALID);
  fs.chmodSync(file, 0o000);
  const res = tryResolveDatabaseUrl({ DATABASE_URL_FILE: file });
  assert.equal(res.ok, false);
  assert.ok(['DATABASE_URL_FILE_UNREADABLE', 'DATABASE_URL_FILE_NOT_FOUND'].includes(res.error.code), `unexpected ${res.error.code}`);
  fs.chmodSync(file, 0o600);
});

test('P1.1-08 non-regular file (directory) fails closed', () => {
  const res = tryResolveDatabaseUrl({ DATABASE_URL_FILE: tmp });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'DATABASE_URL_FILE_NOT_REGULAR_FILE');
});

test('P1.1-09 invalid connection values are rejected', () => {
  assert.equal(tryResolveDatabaseUrl({ DATABASE_URL: 'not-a-url' }).error.code, 'DATABASE_URL_INVALID');
  assert.equal(tryResolveDatabaseUrl({ DATABASE_URL: 'mysql://u:p@h/d' }).error.code, 'DATABASE_URL_PROTOCOL_INVALID');
  assert.equal(tryResolveDatabaseUrl({ DATABASE_URL: 'postgres://db.example:5432/fiberos' }).error.code, 'DATABASE_URL_USER_MISSING');
  assert.equal(tryResolveDatabaseUrl({ DATABASE_URL: 'postgres://u:p@db.example:5432' }).error.code, 'DATABASE_URL_DATABASE_MISSING');
  assert.equal(tryResolveDatabaseUrl({ DATABASE_URL: 'postgres://u:p@db.example:5432/f d' }).error.code, 'DATABASE_URL_INVALID_WHITESPACE');
});

test('P1.1-10 neither variable set reports the requirement without throwing', () => {
  const r = resolveDatabaseUrl({});
  assert.equal(r.configured, false);
  assert.equal(r.url, '');
  assert.equal(r.code, 'DATABASE_URL_OR_DATABASE_URL_FILE_REQUIRED');
});

test('P1.1-11 credentials never appear in errors, redacted form or diagnostics', () => {
  const secret = 'sup3r-s3cret';
  const conflictFile = writeSecret('leak.txt', 'postgres://fiberos_runtime:leaked@db.other:5432/fiberos');
  const res = tryResolveDatabaseUrl({ DATABASE_URL: VALID, DATABASE_URL_FILE: conflictFile });
  const serialized = JSON.stringify(res);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes('leaked'), false);
  assert.equal(res.error.code.includes(secret), false);
  const red = redactDatabaseUrl(VALID);
  assert.equal(red.includes(secret), false);
  assert.ok(red.includes('***'));
  assert.throws(() => validateDatabaseUrl('', 'DATABASE_URL'), (e) => e.code === 'DATABASE_URL_EMPTY' && !e.message.includes(secret));
  assert.throws(() => readSecretFile(path.join(tmp, 'absent.txt'), 'DATABASE_URL_FILE'), (e) => e.code === 'DATABASE_URL_FILE_NOT_FOUND' && !/absent/.test(e.message));
});

test('P1.1-12 runtime pool boundaries consume the canonical resolver', () => {
  const conflictFile = writeSecret('pool-conflict.txt', 'postgres://fiberos_runtime:other@db.other:5432/fiberos');
  const pool = createPool({ DATABASE_URL: VALID, DATABASE_URL_FILE: conflictFile });
  assert.equal(pool.configured, false);
  assert.equal(pool.reason, 'DATABASE_URL_AND_DATABASE_URL_FILE_BOTH_SET_CONFLICT');

  const worker = createWorkerPool({
    DATABASE_WORKER_URL: VALID,
    DATABASE_WORKER_URL_FILE: conflictFile
  });
  assert.equal(worker.configured, false);
  assert.equal(worker.reason, 'DATABASE_WORKER_URL_AND_DATABASE_WORKER_URL_FILE_BOTH_SET_CONFLICT');
});

test('service database secret refuses conflicting inline and file values', () => {
  const matchingFile = writeSecret('service-match.txt', VALID + '\n');
  assert.equal(readSecretEnvValue({ DATABASE_SERVICE_URL_FILE: matchingFile }, 'DATABASE_SERVICE_URL'), VALID);
  assert.equal(readSecretEnvValue({
    DATABASE_SERVICE_URL: VALID,
    DATABASE_SERVICE_URL_FILE: matchingFile
  }, 'DATABASE_SERVICE_URL'), VALID);

  const conflictingFile = writeSecret('service-conflict.txt', 'postgres://fiberos_runtime:other@db.other:5432/fiberos\n');
  assert.throws(
    () => readSecretEnvValue({
      DATABASE_SERVICE_URL: VALID,
      DATABASE_SERVICE_URL_FILE: conflictingFile
    }, 'DATABASE_SERVICE_URL'),
    error => error.code === 'DATABASE_SERVICE_URL_AND_DATABASE_SERVICE_URL_FILE_BOTH_SET_CONFLICT' &&
      !error.message.includes('sup3r-s3cret') &&
      !error.message.includes('other@db.other')
  );
  assert.equal(readSecretEnvValue({}, 'DATABASE_SERVICE_URL'), '');
});

test('invalid database URLs and worker credential fallback fail closed at the pool boundary', async () => {
  const invalid = createPool({ DATABASE_URL: 'not-a-url' });
  assert.equal(invalid.configured, false);
  assert.equal(invalid.reason, 'DATABASE_URL_INVALID');
  await assert.rejects(
    invalid.query('SELECT 1'),
    error => error.code === 'DATABASE_URL_INVALID' && error.statusCode === 503
  );

  // The worker must never silently reuse the API's generic DATABASE_URL.
  const workerWithoutDedicatedCredential = createWorkerPool({ DATABASE_URL: VALID });
  assert.equal(workerWithoutDedicatedCredential.configured, false);
  assert.equal(workerWithoutDedicatedCredential.reason, 'DATABASE_WORKER_URL_MISSING');
  await assert.rejects(
    workerWithoutDedicatedCredential.query('SELECT 1'),
    error => error.code === 'DATABASE_WORKER_URL_MISSING' && error.statusCode === 503
  );
});
