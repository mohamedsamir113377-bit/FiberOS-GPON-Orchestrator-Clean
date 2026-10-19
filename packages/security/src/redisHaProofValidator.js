'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

const REDIS_HA_PROOF_MAX_AGE_DAYS = 180;
const REDIS_HA_PROOF_SCHEMA = 'fiberos.redis-ha-proof.v1';

function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function redisHaProofSigningBytes(data) {
  const signed = {
    domain: 'FiberOS Redis HA readiness evidence',
    schema: data && data.schema,
    keyId: data && data.keyId,
    issuer: data && data.issuer,
    payload: data && data.payload
  };
  return Buffer.from(stableJson(signed), 'utf8');
}

function validateRedisHaProof(data, now = Date.now(), trust = {}) {
  data = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  trust = trust && typeof trust === 'object' ? trust : {};
  const failures = [];
  const allowedTopLevel = new Set(['schema', 'keyId', 'issuer', 'payload', 'signature']);
  if (Object.keys(data).some((key) => !allowedTopLevel.has(key))) failures.push('proof_FIELDS_UNSUPPORTED');
  if (data.schema !== REDIS_HA_PROOF_SCHEMA) failures.push('proof_SCHEMA_INVALID');
  if (typeof data.issuer !== 'string' || !/^[A-Za-z0-9_.:@/-]{1,200}$/.test(data.issuer)) failures.push('issuer_INVALID');
  if (typeof data.keyId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(data.keyId)) failures.push('keyId_INVALID');
  if (!trust.expectedKeyId) failures.push('FIBEROS_REDIS_HA_PROOF_KEY_ID_REQUIRED');
  else if (data.keyId !== trust.expectedKeyId) failures.push('keyId_NOT_TRUSTED');

  const payload = data.payload && typeof data.payload === 'object' && !Array.isArray(data.payload) ? data.payload : {};
  if (typeof payload.provider !== 'string' || !payload.provider.trim()) failures.push('provider_REQUIRED');
  if (typeof payload.resourceId !== 'string' || !payload.resourceId.trim()) failures.push('resourceId_REQUIRED');
  if (typeof payload.evidenceReference !== 'string' || !payload.evidenceReference.trim()) failures.push('evidenceReference_REQUIRED');
  for (const field of ['managedHighAvailability', 'automaticFailoverConfigured', 'failoverTested']) {
    if (payload[field] !== true) failures.push(field);
  }

  const expectedResourceId = String(trust.expectedResourceId || '').trim();
  const expectedBuildRef = String(trust.expectedBuildRef || '').trim();
  if (!expectedResourceId) failures.push('FIBEROS_REDIS_HA_RESOURCE_ID_ENV_REQUIRED');
  else if (payload.resourceId !== expectedResourceId) failures.push('resourceId_NOT_MATCHING_DEPLOYMENT');
  if (!expectedBuildRef) failures.push('FIBEROS_REDIS_HA_BUILD_REF_ENV_REQUIRED');
  else if (payload.buildRef !== expectedBuildRef) failures.push('buildRef_NOT_MATCHING_DEPLOYMENT');

  if (expectedResourceId && expectedBuildRef && typeof payload.evidenceReference === 'string') {
    const expectedPrefix = `${expectedResourceId}:${expectedBuildRef}:`;
    if (!payload.evidenceReference.startsWith(expectedPrefix)) failures.push('evidenceReference_NOT_BOUND_TO_RESOURCE_AND_BUILD');
  }

  const dateText = String(payload.failoverTestedAt || '');
  const testedAt = Date.parse(dateText);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(dateText) || !Number.isFinite(testedAt)) failures.push('failoverTestedAt_INVALID');
  else if (testedAt > now + 5 * 60 * 1000 || now - testedAt > REDIS_HA_PROOF_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) failures.push('failoverTestedAt_NOT_RECENT');

  let publicKey;
  try {
    publicKey = trust.publicKey && trust.publicKey.type === 'public' ? trust.publicKey : crypto.createPublicKey(trust.publicKey);
    if (publicKey.asymmetricKeyType !== 'ed25519') failures.push('publicKey_TYPE_INVALID');
  } catch (_) { failures.push('FIBEROS_REDIS_HA_PROOF_PUBLIC_KEY_INVALID'); }

  let signature;
  try {
    if (typeof data.signature !== 'string') throw new Error('signature missing');
    signature = Buffer.from(data.signature, 'base64');
    if (signature.length !== 64 || signature.toString('base64') !== data.signature) throw new Error('signature encoding');
  } catch (_) { failures.push('signature_INVALID'); }

  if (publicKey && publicKey.asymmetricKeyType === 'ed25519' && signature) {
    try {
      if (!crypto.verify(null, redisHaProofSigningBytes(data), publicKey, signature)) failures.push('signature_NOT_TRUSTED');
    } catch (_) { failures.push('signature_INVALID'); }
  }

  return { ok: failures.length === 0, failures };
}

function readRedisHaTrust(env = process.env) {
  const file = String(env.FIBEROS_REDIS_HA_PROOF_PUBLIC_KEY_FILE || '').trim();
  const expectedKeyId = String(env.FIBEROS_REDIS_HA_PROOF_KEY_ID || '').trim();
  const expectedResourceId = String(env.FIBEROS_REDIS_HA_RESOURCE_ID || '').trim();
  const expectedBuildRef = String(env.FIBEROS_REDIS_HA_BUILD_REF || '').trim();
  if (!file) return { ok: false, error: 'FIBEROS_REDIS_HA_PROOF_PUBLIC_KEY_FILE_REQUIRED' };
  if (!expectedKeyId) return { ok: false, error: 'FIBEROS_REDIS_HA_PROOF_KEY_ID_REQUIRED' };
  if (!expectedResourceId) return { ok: false, error: 'FIBEROS_REDIS_HA_RESOURCE_ID_REQUIRED' };
  if (!expectedBuildRef) return { ok: false, error: 'FIBEROS_REDIS_HA_BUILD_REF_REQUIRED' };
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size < 1 || stat.size > 16384) throw new Error('invalid key file');
    const publicKey = crypto.createPublicKey(fs.readFileSync(file, 'utf8'));
    if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('invalid key type');
    return { ok: true, file, expectedKeyId, expectedResourceId, expectedBuildRef, publicKey };
  } catch (_) {
    return { ok: false, error: 'FIBEROS_REDIS_HA_PROOF_PUBLIC_KEY_INVALID' };
  }
}

module.exports = Object.freeze({
  REDIS_HA_PROOF_MAX_AGE_DAYS,
  REDIS_HA_PROOF_SCHEMA,
  stableJson,
  redisHaProofSigningBytes,
  validateRedisHaProof,
  readRedisHaTrust
});
