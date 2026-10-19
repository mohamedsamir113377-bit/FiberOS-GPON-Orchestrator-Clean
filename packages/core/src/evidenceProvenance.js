'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = 'fiberos.r14.1.evidence-provenance.v1';
const PROOF_LEVELS = new Set(['STATIC_ONLY', 'RUNTIME_DISPOSABLE', 'RUNTIME_STAGING', 'RUNTIME_PRODUCTION', 'NONE']);
const RESULTS = new Set(['PASS_STATIC', 'PASS_RUNTIME', 'FAIL', 'BLOCKED']);

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sha256File(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
    throw new TypeError('EVIDENCE_RELATIVE_PATH_REQUIRED');
  }
  return sha256Bytes(fs.readFileSync(path.join(root, relativePath)));
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function validateProvenance(provenance) {
  const failures = [];
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    return { ok: false, failures: ['PROVENANCE_NOT_OBJECT'] };
  }
  if (provenance.schemaVersion !== SCHEMA) failures.push('SCHEMA_VERSION_INVALID');
  if (typeof provenance.checkId !== 'string' || !provenance.checkId.trim()) failures.push('CHECK_ID_MISSING');
  if (!RESULTS.has(provenance.result)) failures.push('RESULT_INVALID');
  if (!PROOF_LEVELS.has(provenance.proofLevel)) failures.push('PROOF_LEVEL_INVALID');
  if (typeof provenance.observedAt !== 'string' || Number.isNaN(Date.parse(provenance.observedAt))) failures.push('OBSERVED_AT_INVALID');
  for (const key of ['environment', 'executor', 'source', 'evidenceRef']) {
    if (typeof provenance[key] !== 'string' || !provenance[key].trim()) failures.push(`${key.toUpperCase()}_MISSING`);
  }
  if (!isSha256(provenance.inputsHash)) failures.push('INPUTS_HASH_INVALID');
  if (provenance.artifactSetHash !== undefined && !isSha256(provenance.artifactSetHash)) failures.push('ARTIFACT_SET_HASH_INVALID');
  if (provenance.canonicalInventoryHash !== undefined && !isSha256(provenance.canonicalInventoryHash)) failures.push('CANONICAL_INVENTORY_HASH_INVALID');
  if (provenance.result === 'PASS_RUNTIME' && !String(provenance.proofLevel).startsWith('RUNTIME_')) failures.push('RUNTIME_RESULT_WITHOUT_RUNTIME_PROOF_LEVEL');
  if (provenance.result === 'PASS_STATIC' && provenance.proofLevel !== 'STATIC_ONLY') failures.push('STATIC_RESULT_WITHOUT_STATIC_PROOF_LEVEL');
  if (provenance.result === 'BLOCKED' && provenance.proofLevel !== 'NONE') failures.push('BLOCKED_RESULT_MUST_HAVE_NONE_PROOF');
  return { ok: failures.length === 0, failures };
}

function buildArtifactSetHash(root, relativePaths) {
  if (!Array.isArray(relativePaths)) throw new TypeError('ARTIFACT_PATHS_ARRAY_REQUIRED');
  const rows = relativePaths.slice().sort().map((relativePath) => `${relativePath}:${sha256File(root, relativePath)}`);
  return sha256Bytes(rows.join('\n'));
}

module.exports = { SCHEMA, validateProvenance, sha256File, buildArtifactSetHash };
