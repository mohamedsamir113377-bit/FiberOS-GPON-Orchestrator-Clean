'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  REDIS_HA_PROOF_SCHEMA,
  redisHaProofSigningBytes,
  validateRedisHaProof,
  isRedisHaProofRequired
} = require('../../../scripts/production-readiness-gate');

const NOW = Date.parse('2026-09-27T20:00:00.000Z');
const KEY_ID = 'api-readiness-test-key';
const keys = crypto.generateKeyPairSync('ed25519');
const RESOURCE_ID = 'redis-primary-prod';
const BUILD_REF = 'git-tag:v14.1-2026-09-28';
const trust = { expectedKeyId: KEY_ID, expectedResourceId: RESOURCE_ID, expectedBuildRef: BUILD_REF, publicKey: keys.publicKey };
const CURRENT_PAYLOAD = {
  provider: 'approved-provider',
  resourceId: RESOURCE_ID,
  buildRef: BUILD_REF,
  managedHighAvailability: true,
  automaticFailoverConfigured: true,
  failoverTested: true,
  failoverTestedAt: '2026-09-01T12:00:00.000Z',
  evidenceReference: `${RESOURCE_ID}:${BUILD_REF}:failover-test-7`
};

function signedProof(payload = CURRENT_PAYLOAD) {
  const proof = {
    schema: REDIS_HA_PROOF_SCHEMA,
    keyId: KEY_ID,
    issuer: 'approved-infrastructure-ci',
    payload
  };
  return { ...proof, signature: crypto.sign(null, redisHaProofSigningBytes(proof), keys.privateKey).toString('base64') };
}

test('Redis HA evidence is a production prerequisite only when Redis is the selected backend', () => {
  assert.equal(isRedisHaProofRequired('REDIS'), true);
  assert.equal(isRedisHaProofRequired('redis'), true);
  assert.equal(isRedisHaProofRequired('PROCESS_LOCAL'), false);
});

test('Redis HA proof rejects missing unsigned boolean-only attestations', () => {
  const result = validateRedisHaProof({
    managedHighAvailability: true,
    automaticFailoverConfigured: true,
    failoverTested: true,
    failoverTestedAt: '2026-09-01T12:00:00.000Z'
  }, NOW, trust);
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes('proof_SCHEMA_INVALID'));
  assert.ok(result.failures.includes('signature_INVALID'));
});

test('recent signed Redis failover proof passes only with the pinned Ed25519 trust key', () => {
  assert.deepEqual(validateRedisHaProof(signedProof(), NOW, trust), { ok: true, failures: [] });
  assert.ok(validateRedisHaProof(signedProof(), NOW, { ...trust, expectedKeyId: 'untrusted-key' }).failures.includes('keyId_NOT_TRUSTED'));
});

test('stale and future-dated signed Redis failover proofs fail closed', () => {
  const stale = validateRedisHaProof(signedProof({ ...CURRENT_PAYLOAD, failoverTestedAt: '2025-01-01T00:00:00.000Z' }), NOW, trust);
  assert.ok(stale.failures.includes('failoverTestedAt_NOT_RECENT'));
  const future = validateRedisHaProof(signedProof({ ...CURRENT_PAYLOAD, failoverTestedAt: '2027-01-01T00:00:00.000Z' }), NOW, trust);
  assert.ok(future.failures.includes('failoverTestedAt_NOT_RECENT'));
});
