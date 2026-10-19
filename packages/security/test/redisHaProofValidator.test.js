'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { REDIS_HA_PROOF_SCHEMA, redisHaProofSigningBytes, validateRedisHaProof } = require('../src/redisHaProofValidator');

const now = Date.parse('2026-09-28T00:00:00.000Z');
const pair = crypto.generateKeyPairSync('ed25519');
const trust = { expectedKeyId: 'ci-key-1', expectedResourceId: 'redis-prod-1', expectedBuildRef: 'git-tag:v14.1-2026-09-28', publicKey: pair.publicKey };
const payload = {
  provider: 'approved-managed-redis', resourceId: 'redis-prod-1', buildRef: 'git-tag:v14.1-2026-09-28',
  managedHighAvailability: true, automaticFailoverConfigured: true, failoverTested: true,
  failoverTestedAt: '2026-08-01T12:00:00.000Z', evidenceReference: 'redis-prod-1:git-tag:v14.1-2026-09-28:failover-0042'
};
function sign(p = payload, keyId = trust.expectedKeyId, keyPair = pair) {
  const unsigned = { schema: REDIS_HA_PROOF_SCHEMA, keyId, issuer: 'trusted-ci', payload: p };
  return { ...unsigned, signature: crypto.sign(null, redisHaProofSigningBytes(unsigned), keyPair.privateKey).toString('base64') };
}

test('1 valid proof passes', () => assert.deepEqual(validateRedisHaProof(sign(), now, trust), { ok: true, failures: [] }));
test('2 mismatched resource is rejected', () => assert.ok(validateRedisHaProof(sign({ ...payload, resourceId: 'redis-staging-1' }), now, trust).failures.includes('resourceId_NOT_MATCHING_DEPLOYMENT')));
test('3 mismatched build is rejected', () => assert.ok(validateRedisHaProof(sign({ ...payload, buildRef: 'git-tag:v14.1-other' }), now, trust).failures.includes('buildRef_NOT_MATCHING_DEPLOYMENT')));
test('4 unbound evidence reference is rejected', () => assert.ok(validateRedisHaProof(sign({ ...payload, evidenceReference: 'redis-prod-1:other:failover' }), now, trust).failures.includes('evidenceReference_NOT_BOUND_TO_RESOURCE_AND_BUILD')));
test('5 missing resource trust configuration fails closed', () => assert.ok(validateRedisHaProof(sign(), now, { ...trust, expectedResourceId: '' }).failures.includes('FIBEROS_REDIS_HA_RESOURCE_ID_ENV_REQUIRED')));
test('6 missing build trust configuration fails closed', () => assert.ok(validateRedisHaProof(sign(), now, { ...trust, expectedBuildRef: '' }).failures.includes('FIBEROS_REDIS_HA_BUILD_REF_ENV_REQUIRED')));
test('7 wrong key id is rejected', () => assert.ok(validateRedisHaProof(sign(payload, 'other'), now, trust).failures.includes('keyId_NOT_TRUSTED')));
test('8 wrong signing key is rejected', () => assert.ok(validateRedisHaProof(sign(payload, trust.expectedKeyId, crypto.generateKeyPairSync('ed25519')), now, trust).failures.includes('signature_NOT_TRUSTED')));
test('9 altered signed payload is rejected', () => { const p = sign(); assert.ok(validateRedisHaProof({ ...p, payload: { ...p.payload, failoverTested: false } }, now, trust).failures.includes('signature_NOT_TRUSTED')); });
test('10 stale proof is rejected', () => assert.ok(validateRedisHaProof(sign({ ...payload, failoverTestedAt: '2025-01-01T00:00:00.000Z' }), now, trust).failures.includes('failoverTestedAt_NOT_RECENT')));
test('11 future proof outside tolerance is rejected', () => assert.ok(validateRedisHaProof(sign({ ...payload, failoverTestedAt: '2026-10-01T00:00:00.000Z' }), now, trust).failures.includes('failoverTestedAt_NOT_RECENT')));
test('12 unsupported top-level fields are rejected', () => assert.ok(validateRedisHaProof({ ...sign(), extra: true }, now, trust).failures.includes('proof_FIELDS_UNSUPPORTED')));
test('13 invalid signature encoding is rejected', () => assert.ok(validateRedisHaProof({ ...sign(), signature: 'not-base64!' }, now, trust).failures.includes('signature_INVALID')));
