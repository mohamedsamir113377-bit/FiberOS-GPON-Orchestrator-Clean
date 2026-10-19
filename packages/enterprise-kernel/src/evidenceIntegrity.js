'use strict';

const crypto = require('crypto');

function sha256Bytes(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (Buffer.isBuffer(value)) return value.toString('base64');
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = canonical(value[key]);
    return out;
  }, {});
}

function sha256Content(value) {
  if (Buffer.isBuffer(value)) return sha256Bytes(value);
  if (value instanceof Uint8Array) return sha256Bytes(Buffer.from(value));
  if (typeof value === 'string') return sha256Bytes(Buffer.from(value, 'utf8'));
  return sha256Bytes(Buffer.from(JSON.stringify(canonical(value))));
}

function validateEvidenceEnvelope(e, options = {}) {
  const errors = [];
  if (!e || !e.ticketId) errors.push('TICKET_ID_REQUIRED');
  if (!e || !e.kind) errors.push('EVIDENCE_KIND_REQUIRED');
  if (!e || !e.source) errors.push('EVIDENCE_SOURCE_REQUIRED');
  if (e && e.source === 'ai_simulated' && e.finalClosure === true) errors.push('AI_SIMULATED_CANNOT_FINAL_CLOSE');
  if (e && e.source === 'ai_simulated' && (e.verified === true || e.liveVerified === true)) errors.push('AI_SIMULATED_CANNOT_BE_VERIFIED_LIVE');
  if (e && e.capturedAt && Number.isNaN(new Date(e.capturedAt).getTime())) errors.push('CAPTURED_AT_INVALID');
  if (e && e.observedAt && Number.isNaN(new Date(e.observedAt).getTime())) errors.push('OBSERVED_AT_INVALID');

  const hasHash = Boolean(e && e.contentHash);
  const content = e && (Object.prototype.hasOwnProperty.call(e, 'content') ? e.content : e.payload);
  if (hasHash) {
    if (!/^[a-f0-9]{64}$/i.test(String(e.contentHash))) errors.push('CONTENT_HASH_FORMAT_INVALID');
    if (content === undefined) errors.push('CONTENT_REQUIRED_FOR_HASH');
    else if (sha256Content(content) !== String(e.contentHash).toLowerCase()) errors.push('CONTENT_HASH_MISMATCH');
  }

  const requireContentHash = options.requireContentHash === true || Boolean(
    e && e.finalClosure === true && options.requireContentHashForFinalClosure !== false
  );
  if (requireContentHash && !hasHash) errors.push('CONTENT_HASH_REQUIRED');

  return { ok: errors.length === 0, errors };
}

module.exports = { sha256Bytes, sha256Content, validateEvidenceEnvelope };
