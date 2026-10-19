'use strict';

const crypto = require('node:crypto');
const { appendRecord } = require('./runtimeEvidenceStore');
const { buildArtifactSetHash } = require('./evidenceProvenance');

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function captureRuntimeEvidence(root, options = {}) {
  const {
    checkId,
    result,
    proofLevel,
    releaseId,
    canonicalInventoryHash,
    artifactPaths = [],
    environment,
    executor,
    source,
    evidenceRef,
    command,
    input = {}
  } = options;

  if (!['PASS_RUNTIME', 'FAIL'].includes(result)) throw new Error('RUNTIME_CAPTURE_RESULT_INVALID');
  if (!['RUNTIME_DISPOSABLE', 'RUNTIME_STAGING', 'RUNTIME_PRODUCTION'].includes(proofLevel)) throw new Error('RUNTIME_CAPTURE_PROOF_LEVEL_INVALID');
  if (typeof releaseId !== 'string' || !releaseId.trim()) throw new Error('RUNTIME_CAPTURE_RELEASE_ID_REQUIRED');
  if (typeof canonicalInventoryHash !== 'string' || !/^[a-f0-9]{64}$/.test(canonicalInventoryHash)) throw new Error('RUNTIME_CAPTURE_INVENTORY_HASH_INVALID');

  const artifactSetHash = buildArtifactSetHash(root, artifactPaths);
  const inputsHash = sha256(JSON.stringify(input));
  const provenance = {
    schemaVersion: 'fiberos.r14.1.evidence-provenance.v1',
    checkId,
    result,
    proofLevel,
    observedAt: new Date().toISOString(),
    environment,
    executor,
    source,
    evidenceRef,
    inputsHash,
    artifactSetHash,
    canonicalInventoryHash,
    command
  };

  return appendRecord(root, {
    releaseId,
    artifactSetHash,
    canonicalInventoryHash,
    proofLevel,
    result,
    provenance
  });
}

module.exports = { captureRuntimeEvidence };
