'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildArtifactSetHash } = require('../src/evidenceProvenance');
const { appendRecord, verifyStore } = require('../src/runtimeEvidenceStore');
const { captureRuntimeEvidence } = require('../src/runtimeEvidenceCapture');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fiberos-runtime-evidence-'));
}

function inventoryHash() {
  return 'a'.repeat(64);
}

test('runtime evidence records are chained and verifiable', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'input.txt'), 'fiberos');
  const artifactSetHash = buildArtifactSetHash(root, ['input.txt']);
  const record = appendRecord(root, {
    releaseId: 'test-release',
    artifactSetHash,
    canonicalInventoryHash: inventoryHash(),
    proofLevel: 'RUNTIME_DISPOSABLE',
    result: 'PASS_RUNTIME',
    provenance: {
      schemaVersion: 'fiberos.r14.1.evidence-provenance.v1',
      checkId: 'test.check',
      result: 'PASS_RUNTIME',
      proofLevel: 'RUNTIME_DISPOSABLE',
      observedAt: new Date().toISOString(),
      environment: 'test',
      executor: 'node-test',
      source: 'input.txt',
      evidenceRef: 'test:record',
      inputsHash: 'b'.repeat(64),
      artifactSetHash,
      canonicalInventoryHash: inventoryHash()
    }
  });
  assert.equal(record.sequence, 1);
  assert.equal(record.previousRecordHash, '0'.repeat(64));
  assert.equal(verifyStore(root, {
    expectedReleaseId: 'test-release',
    expectedArtifactSetHash: artifactSetHash,
    expectedInventoryHash: inventoryHash()
  }).ok, true);
});

test('tampering with a record breaks the chain', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'input.txt'), 'fiberos');
  const artifactSetHash = buildArtifactSetHash(root, ['input.txt']);
  const record = appendRecord(root, {
    releaseId: 'test-release',
    artifactSetHash,
    canonicalInventoryHash: inventoryHash(),
    proofLevel: 'RUNTIME_DISPOSABLE',
    result: 'FAIL',
    provenance: {
      schemaVersion: 'fiberos.r14.1.evidence-provenance.v1',
      checkId: 'test.check',
      result: 'FAIL',
      proofLevel: 'RUNTIME_DISPOSABLE',
      observedAt: new Date().toISOString(),
      environment: 'test',
      executor: 'node-test',
      source: 'input.txt',
      evidenceRef: 'test:record',
      inputsHash: 'b'.repeat(64),
      artifactSetHash,
      canonicalInventoryHash: inventoryHash()
    }
  });
  const store = path.join(root, 'evidence', 'r14_1', 'runtime', 'records.jsonl');
  const tampered = JSON.parse(fs.readFileSync(store, 'utf8'));
  tampered.result = 'PASS_RUNTIME';
  fs.writeFileSync(store, JSON.stringify(tampered) + '\n');
  const verification = verifyStore(root, {
    expectedReleaseId: 'test-release',
    expectedArtifactSetHash: artifactSetHash,
    expectedInventoryHash: inventoryHash()
  });
  assert.equal(verification.ok, false);
  assert.ok(verification.failures.some((failure) => failure.includes('RECORD_HASH_MISMATCH')));
  assert.equal(record.sequence, 1);
});

test('captureRuntimeEvidence binds the proof to release, inventory and artifacts', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'input.txt'), 'fiberos');
  const artifactSetHash = buildArtifactSetHash(root, ['input.txt']);
  const record = captureRuntimeEvidence(root, {
    checkId: 'integration.test',
    result: 'PASS_RUNTIME',
    proofLevel: 'RUNTIME_DISPOSABLE',
    releaseId: 'test-release',
    canonicalInventoryHash: inventoryHash(),
    artifactPaths: ['input.txt'],
    environment: 'test',
    executor: 'node-test',
    source: 'input.txt',
    evidenceRef: 'test:capture',
    command: 'node --test',
    input: { sample: true }
  });
  assert.equal(record.artifactSetHash, artifactSetHash);
  assert.equal(record.canonicalInventoryHash, inventoryHash());
  assert.equal(record.provenance.checkId, 'integration.test');
});

test('matrix evidence compatibility validator rejects example files as proof', () => {
  const { validateMatrixEvidenceFile } = require('../src/matrixEvidenceValidator');
  const example = path.resolve(__dirname, '../../../config/matrix-evidence.example.json');
  const result = validateMatrixEvidenceFile(example);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'EXAMPLE_FILE_NOT_ALLOWED_AS_EVIDENCE');
});
