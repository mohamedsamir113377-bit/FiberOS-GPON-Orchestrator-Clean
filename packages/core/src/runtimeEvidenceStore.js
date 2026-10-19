'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { validateProvenance } = require('./evidenceProvenance');

const SCHEMA = 'fiberos.r14.1.runtime-evidence-record.v1';
const STORE_SCHEMA = 'fiberos.r14.1.runtime-evidence-store.v1';
const PROOF_LEVELS = new Set(['RUNTIME_DISPOSABLE', 'RUNTIME_STAGING', 'RUNTIME_PRODUCTION']);
const RESULTS = new Set(['PASS_RUNTIME', 'FAIL']);
const ZERO_HASH = '0'.repeat(64);

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function storePath(root) {
  return path.join(root, 'evidence', 'r14_1', 'runtime', 'records.jsonl');
}

function lockPath(root) {
  return path.join(root, 'evidence', 'r14_1', 'runtime', 'runtime-evidence.lock');
}

function acquireLock(root, timeoutMs = 5000) {
  const target = lockPath(root);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const started = Date.now();
  while (true) {
    try {
      const fd = fs.openSync(target, 'wx', 0o600);
      fs.writeFileSync(fd, String(process.pid), { encoding: 'utf8' });
      return fd;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() - started >= timeoutMs) throw new Error('RUNTIME_EVIDENCE_STORE_LOCK_TIMEOUT');
      const until = Date.now() + 25;
      while (Date.now() < until) {}
    }
  }
}

function releaseLock(root, fd) {
  try {
    fs.closeSync(fd);
  } finally {
    try {
      fs.unlinkSync(lockPath(root));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function canonicalRecord(record) {
  const copy = JSON.parse(JSON.stringify(record));
  delete copy.recordHash;
  return JSON.stringify(copy);
}

function validateRecord(record, options = {}) {
  const failures = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { ok: false, failures: ['RECORD_NOT_OBJECT'] };
  if (record.schema !== SCHEMA) failures.push('SCHEMA_INVALID');
  if (!Number.isInteger(record.sequence) || record.sequence < 1) failures.push('SEQUENCE_INVALID');
  if (!PROOF_LEVELS.has(record.proofLevel)) failures.push('RUNTIME_PROOF_LEVEL_INVALID');
  if (!RESULTS.has(record.result)) failures.push('RUNTIME_RESULT_INVALID');
  if (typeof record.releaseId !== 'string' || !record.releaseId.trim()) failures.push('RELEASE_ID_MISSING');
  if (options.expectedReleaseId && record.releaseId !== options.expectedReleaseId) failures.push('RELEASE_ID_MISMATCH');
  if (!/^[a-f0-9]{64}$/.test(record.artifactSetHash || '')) failures.push('ARTIFACT_SET_HASH_INVALID');
  if (options.expectedArtifactSetHash && record.artifactSetHash !== options.expectedArtifactSetHash) failures.push('ARTIFACT_SET_HASH_MISMATCH');
  if (!/^[a-f0-9]{64}$/.test(record.canonicalInventoryHash || '')) failures.push('CANONICAL_INVENTORY_HASH_INVALID');
  if (options.expectedInventoryHash && record.canonicalInventoryHash !== options.expectedInventoryHash) failures.push('CANONICAL_INVENTORY_HASH_MISMATCH');
  if (!/^[a-f0-9]{64}$/.test(record.previousRecordHash || '')) failures.push('PREVIOUS_HASH_INVALID');
  if (!/^[a-f0-9]{64}$/.test(record.recordHash || '')) failures.push('RECORD_HASH_INVALID');

  const provenance = validateProvenance(record.provenance);
  if (!provenance.ok) failures.push(...provenance.failures.map((value) => `PROVENANCE:${value}`));
  if (record.provenance) {
    if (record.provenance.result !== record.result) failures.push('PROVENANCE_RESULT_MISMATCH');
    if (record.provenance.proofLevel !== record.proofLevel) failures.push('PROVENANCE_PROOF_LEVEL_MISMATCH');
    if (record.provenance.artifactSetHash !== record.artifactSetHash) failures.push('PROVENANCE_ARTIFACT_HASH_MISMATCH');
    if (record.provenance.canonicalInventoryHash !== record.canonicalInventoryHash) failures.push('PROVENANCE_INVENTORY_HASH_MISMATCH');
  }
  if (/^[a-f0-9]{64}$/.test(record.recordHash || '') && record.recordHash !== sha256(canonicalRecord(record))) {
    failures.push('RECORD_HASH_MISMATCH');
  }
  return { ok: failures.length === 0, failures };
}

function verifyStore(root, options = {}) {
  const file = storePath(root);
  if (!fs.existsSync(file)) return { ok: true, exists: false, count: 0, failures: [], records: [] };
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const failures = [];
  const records = [];
  let previous = ZERO_HASH;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      failures.push(`LINE_${lineNumber}_JSON_INVALID`);
      return;
    }
    if (record.sequence !== lineNumber) failures.push(`LINE_${lineNumber}_SEQUENCE_INVALID`);
    if (record.previousRecordHash !== previous) failures.push(`LINE_${lineNumber}_CHAIN_BREAK`);
    const validation = validateRecord(record, options);
    if (!validation.ok) failures.push(...validation.failures.map((failure) => `LINE_${lineNumber}:${failure}`));
    previous = record.recordHash || previous;
    records.push(record);
  });

  return { ok: failures.length === 0, exists: true, count: records.length, failures, records };
}

function appendRecord(root, record, options = {}) {
  const lockFd = acquireLock(root, Math.max(1000, Number(options.lockTimeoutMs || process.env.RUNTIME_EVIDENCE_LOCK_TIMEOUT_MS || 5000)));
  try {
    const expected = {
      expectedReleaseId: record.releaseId,
      expectedArtifactSetHash: record.artifactSetHash,
      expectedInventoryHash: record.canonicalInventoryHash
    };
    const verification = verifyStore(root, expected);
    if (!verification.ok) throw new Error(`RUNTIME_EVIDENCE_STORE_NOT_VERIFIABLE:${verification.failures.join(',')}`);

    const sequence = verification.count + 1;
    const previousRecordHash = verification.count ? verification.records[verification.count - 1].recordHash : ZERO_HASH;
    const candidate = { ...record, schema: SCHEMA, sequence, previousRecordHash };
    candidate.recordHash = sha256(canonicalRecord(candidate));
    const validation = validateRecord(candidate, expected);
    if (!validation.ok) throw new Error(`RUNTIME_EVIDENCE_RECORD_INVALID:${validation.failures.join(',')}`);

    const file = storePath(root);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const fd = fs.openSync(file, 'a', 0o600);
    try {
      fs.writeSync(fd, `${JSON.stringify(candidate)}\n`, null, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return candidate;
  } finally {
    releaseLock(root, lockFd);
  }
}

module.exports = { SCHEMA, STORE_SCHEMA, storePath, lockPath, validateRecord, verifyStore, appendRecord };
