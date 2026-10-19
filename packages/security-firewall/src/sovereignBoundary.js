'use strict';

const crypto = require('node:crypto');

const MAX_SKEW_MS = 5000;
const DEFAULT_TTL_MS = 60_000;

function header(headers, name) {
  const wanted = String(name).toLowerCase();
  for (const key of Object.keys(headers || {})) {
    if (String(key).toLowerCase() === wanted) return headers[key];
  }
  return '';
}

function secretFrom(env) {
  return String((env || process.env).FIBEROS_KERNEL_HMAC_SECRET || (env || process.env).SIGNING_HMAC_SECRET || '').trim();
}

function canonicalRequest({ tenantId, timestamp, nonce, method, path, bodyHash }) {
  return [tenantId, timestamp, String(method || 'GET').toUpperCase(), path || '/', nonce, bodyHash || ''].join('\n');
}

function expectedSignature(input, secret) {
  return crypto.createHmac('sha256', secret).update(canonicalRequest(input)).digest('hex');
}

function timingSafeHexEqual(actual, expected) {
  const a = Buffer.from(String(actual || '').trim(), 'utf8');
  const b = Buffer.from(String(expected || '').trim(), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createSovereignBoundary(options) {
  options = options || {};
  const seenNonces = new Map();
  const now = options.now || (() => Date.now());
  const ttlMs = Number.isInteger(options.ttlMs) && options.ttlMs > 0 ? options.ttlMs : DEFAULT_TTL_MS;

  function purge(at) {
    for (const [key, expires] of seenNonces) if (expires <= at) seenNonces.delete(key);
  }

  function reject(code) {
    return { allow: false, code, status: 401, securityHeaders: { 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff' } };
  }

  function evaluate(request, env) {
    const headers = request && request.headers || {};
    const tenantId = String(header(headers, 'x-tenant-id') || '').trim();
    const timestampRaw = String(header(headers, 'x-kernel-timestamp') || '').trim();
    const nonce = String(header(headers, 'x-kernel-nonce') || '').trim();
    const signature = String(header(headers, 'x-kernel-signature') || '').trim();
    const at = Number(now());
    purge(at);
    if (!tenantId || !/^[-A-Za-z0-9_.:]{1,128}$/.test(tenantId) || !/^[-A-Za-z0-9_.:]{16,256}$/.test(nonce)) return reject('KERNEL_BOUNDARY_INVALID');
    const timestamp = Number(timestampRaw);
    if (!Number.isSafeInteger(timestamp) || Math.abs(at - timestamp) > MAX_SKEW_MS) return reject('KERNEL_TIMESTAMP_REJECTED');
    const secret = secretFrom(env);
    if (Buffer.byteLength(secret, 'utf8') < 16) return reject('KERNEL_SECRET_NOT_CONFIGURED');
    const expected = expectedSignature({ tenantId, timestamp, nonce, method: request.method, path: request.path, bodyHash: header(headers, 'x-content-sha256') }, secret);
    if (!timingSafeHexEqual(signature, expected)) return reject('KERNEL_SIGNATURE_REJECTED');
    const replayKey = `${tenantId}:${nonce}`;
    if (seenNonces.has(replayKey)) return reject('KERNEL_REPLAY_REJECTED');
    seenNonces.set(replayKey, at + ttlMs);
    return { allow: true, tenantId, timestamp, nonce };
  }

  return Object.freeze({ evaluate, seenNonces });
}

module.exports = Object.freeze({ MAX_SKEW_MS, canonicalRequest, expectedSignature, createSovereignBoundary });
