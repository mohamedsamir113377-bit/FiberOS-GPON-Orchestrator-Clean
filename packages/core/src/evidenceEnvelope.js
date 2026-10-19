/**
 * Evidence envelope — server recomputes SHA-256 (Node crypto).
 * Client-side advisory hash is never trusted for authorization.
 */
'use strict';

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map(function (k) {
    return JSON.stringify(k) + ':' + stableStringify(v[k]);
  }).join(',') + '}';
}

function uuid() {
  // Security boundary: never fall back to Math.random for identifiers.
  // Node runtimes supported by FiberOS must provide crypto.randomUUID().
  return require('crypto').randomUUID();
}

function sha256HexSync(text) {
  return require('crypto').createHash('sha256').update(String(text), 'utf8').digest('hex');
}

async function sha256Hex(text) {
  return sha256HexSync(text);
}

async function createEvidenceEnvelope(payload) {
  var key = payload && payload.clientIdempotencyKey ? String(payload.clientIdempotencyKey) : uuid();
  var body = Object.assign({}, payload || {}, { idempotencyKey: key });
  var hash = sha256HexSync(stableStringify(body));
  return {
    idempotencyKey: key,
    requestHash: hash,
    payload: body,
    createdAt: new Date().toISOString(),
    status: 'pending',
    attempts: 0,
    hashAuthority: 'server_sha256'
  };
}

function recomputeRequestHash(payload) {
  return sha256HexSync(stableStringify(payload || {}));
}

module.exports = {
  stableStringify: stableStringify,
  createEvidenceEnvelope: createEvidenceEnvelope,
  sha256Hex: sha256Hex,
  sha256HexSync: sha256HexSync,
  recomputeRequestHash: recomputeRequestHash
};
