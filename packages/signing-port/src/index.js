'use strict';

/**
 * SigningPort — INTERFACE_CONTRACTS phase F (server only).
 * Browser never sees keys. Empty/missing secret => FAIL_CLOSED.
 */

const crypto = require('crypto');

const PURPOSE_ALLOWLIST = Object.freeze([
  'ticket_close',
  'topology_change',
  'financial_op',
  'capacity_change',
  'sensitive_close'
]);

function getSecret(env) {
  env = env || process.env;
  const s = env.SIGNING_HMAC_SECRET || env.FIBEROS_SIGNING_SECRET || '';
  return String(s).trim();
}

function canonicalPayload(payload) {
  if (payload == null || typeof payload !== 'object') return null;
  // stable JSON: sort top-level keys
  const keys = Object.keys(payload).sort();
  const ordered = {};
  for (const k of keys) ordered[k] = payload[k];
  return JSON.stringify(ordered);
}

/**
 * @returns {{ ok: true, signatureRef: string, purpose: string } | { ok: false, error: string }}
 */
function sign(payload, purpose, env) {
  const secret = getSecret(env);
  if (!secret || secret.length < 16) {
    return { ok: false, error: 'SIGNING_SECRET_MISSING_OR_WEAK', failClosed: true };
  }
  const p = String(purpose || '').trim();
  if (!PURPOSE_ALLOWLIST.includes(p)) {
    return { ok: false, error: 'SIGNING_PURPOSE_NOT_ALLOWED', failClosed: true };
  }
  const canonical = canonicalPayload(payload);
  if (!canonical) {
    return { ok: false, error: 'SIGNING_PAYLOAD_INVALID', failClosed: true };
  }
  const h = crypto.createHmac('sha256', secret);
  h.update(p);
  h.update('\n');
  h.update(canonical);
  const signatureRef = 'hs256:' + h.digest('hex');
  return { ok: true, signatureRef: signatureRef, purpose: p, algorithm: 'HMAC-SHA256' };
}

/**
 * @returns {{ ok: boolean, error?: string }}
 */
function verify(payload, signatureRef, purpose, env) {
  const secret = getSecret(env);
  if (!secret || secret.length < 16) {
    return { ok: false, error: 'SIGNING_SECRET_MISSING_OR_WEAK', failClosed: true };
  }
  if (!signatureRef || typeof signatureRef !== 'string') {
    return { ok: false, error: 'SIGNATURE_REF_MISSING', failClosed: true };
  }
  const expected = sign(payload, purpose, env);
  if (!expected.ok) return expected;
  const a = Buffer.from(String(signatureRef));
  const b = Buffer.from(String(expected.signatureRef));
  if (a.length !== b.length) {
    return { ok: false, error: 'SIGNATURE_MISMATCH', failClosed: true };
  }
  const match = crypto.timingSafeEqual(a, b);
  return match
    ? { ok: true, purpose: expected.purpose }
    : { ok: false, error: 'SIGNATURE_MISMATCH', failClosed: true };
}

module.exports = {
  PURPOSE_ALLOWLIST,
  sign,
  verify,
  getSecretConfigured: function (env) {
    const s = getSecret(env);
    return s.length >= 16;
  }
};
