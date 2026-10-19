'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  REDIS_HA_PROOF_SCHEMA,
  redisHaProofSigningBytes,
  validateRedisHaProof,
  validateRedisHaTopology,
  isRedisHaProofRequired
} = require('../../../scripts/production-readiness-gate');

const now = Date.parse('2026-09-28T00:00:00.000Z');
const keyId = 'fiberos-ha-ci-2026';
const keyPair = crypto.generateKeyPairSync('ed25519');
const resourceId = 'redis-prod-region-a';
const buildRef = 'git-tag:v14.1-2026-09-28';
const trust = { expectedKeyId: keyId, expectedResourceId: resourceId, expectedBuildRef: buildRef, publicKey: keyPair.publicKey };
const validPayload = {
  provider: 'approved-managed-redis',
  resourceId,
  buildRef,
  managedHighAvailability: true,
  automaticFailoverConfigured: true,
  failoverTested: true,
  failoverTestedAt: '2026-08-01T12:00:00.000Z',
  evidenceReference: `${resourceId}:${buildRef}:failover-test-0042`
};

function signedProof(payload = validPayload, pair = keyPair, proofKeyId = keyId) {
  const unsigned = {
    schema: REDIS_HA_PROOF_SCHEMA,
    keyId: proofKeyId,
    issuer: 'trusted-infrastructure-ci',
    payload
  };
  return {
    ...unsigned,
    signature: crypto.sign(null, redisHaProofSigningBytes(unsigned), pair.privateKey).toString('base64')
  };
}

test('Redis HA proof requires a trusted Ed25519 signature, provider evidence, and a recent real failover record', () => {
  assert.deepEqual(validateRedisHaProof(signedProof(), now, trust), { ok: true, failures: [] });
  assert.equal(validateRedisHaProof({ ...validPayload }, now, trust).ok, false, 'legacy self-attested booleans are rejected');
  assert.ok(validateRedisHaProof({}, now, trust).failures.includes('proof_SCHEMA_INVALID'));
  assert.ok(validateRedisHaProof(signedProof({ ...validPayload, failoverTestedAt: '2025-01-01T00:00:00Z' }), now, trust).failures.includes('failoverTestedAt_NOT_RECENT'));
  assert.ok(validateRedisHaProof(signedProof({ ...validPayload, failoverTestedAt: '2026-10-01T00:00:00Z' }), now, trust).failures.includes('failoverTestedAt_NOT_RECENT'));
  assert.ok(validateRedisHaProof(signedProof({ ...validPayload, failoverTestedAt: 'not-a-date' }), now, trust).failures.includes('failoverTestedAt_INVALID'));
});

test('Redis HA proof rejects missing, altered, wrongly keyed, and unsupported signed data', () => {
  const proof = signedProof();
  assert.ok(validateRedisHaProof({ ...proof, signature: '' }, now, trust).failures.includes('signature_INVALID'));
  assert.ok(validateRedisHaProof({ ...proof, payload: { ...proof.payload, failoverTested: false } }, now, trust).failures.includes('signature_NOT_TRUSTED'));
  assert.ok(validateRedisHaProof(proof, now, { ...trust, expectedKeyId: 'other-key' }).failures.includes('keyId_NOT_TRUSTED'));
  const otherPair = crypto.generateKeyPairSync('ed25519');
  assert.ok(validateRedisHaProof(proof, now, { ...trust, publicKey: otherPair.publicKey }).failures.includes('signature_NOT_TRUSTED'));
  assert.ok(validateRedisHaProof({ ...proof, extra: true }, now, trust).failures.includes('proof_FIELDS_UNSUPPORTED'));
  assert.ok(validateRedisHaProof(signedProof({ ...validPayload, provider: '' }), now, trust).failures.includes('provider_REQUIRED'));
});

test('Redis HA proof requirement is conditional on the selected shared backend', () => {
  assert.equal(isRedisHaProofRequired('REDIS'), true);
  assert.equal(isRedisHaProofRequired('redis'), true);
  assert.equal(isRedisHaProofRequired('PROCESS_LOCAL'), false);
});

test('live Redis topology must be a primary with at least one connected replica', () => {
  assert.deepEqual(validateRedisHaTopology({ role: 'master', connectedReplicaCount: 1 }), { ok: true, failures: [] });
  assert.ok(validateRedisHaTopology({ role: 'master', connectedReplicaCount: 0 }).failures.includes('REDIS_CONNECTED_REPLICA_REQUIRED'));
  assert.ok(validateRedisHaTopology({ role: 'replica', connectedReplicaCount: 1 }).failures.includes('REDIS_PRIMARY_ROLE_REQUIRED'));
  assert.ok(validateRedisHaTopology({ role: 'master', connectedReplicaCount: NaN }).failures.includes('REDIS_CONNECTED_REPLICA_REQUIRED'));
});

test('production gate wires the signed proof and live topology requirements into the runtime contract', () => {
  const root = path.resolve(__dirname, '../../..');
  const gate = fs.readFileSync(path.join(root, 'scripts/production-readiness-gate.js'), 'utf8');
  const validator = fs.readFileSync(path.join(root, 'packages/security/src/redisHaProofValidator.js'), 'utf8');
  const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/runtime-environment-contract.v1.json'), 'utf8'));
  assert.match(validator, /crypto\.verify\(null, redisHaProofSigningBytes/);
  assert.match(gate, /validateRedisHaProof\(/);
  assert.match(gate, /readRedisHaTrust/);
  assert.match(validator, /FIBEROS_REDIS_HA_RESOURCE_ID/);
  assert.match(validator, /FIBEROS_REDIS_HA_BUILD_REF/);
  assert.match(gate, /store\.inspectHaTopology\(\)/);
  assert.match(validator, /FIBEROS_REDIS_HA_PROOF_KEY_ID/);
  assert.match(contract.conditionalDependencies.FIBEROS_REDIS_HA_PROOF_FILE, /signed with Ed25519/);
  assert.match(contract.conditionalDependencies.FIBEROS_REDIS_HA_PROOF_FILE, /connected replica/);
  assert.doesNotMatch(contract.conditionalDependencies.FIBEROS_REDIS_HA_PROOF_FILE, /operator attestation is not independently verified/i);
});
