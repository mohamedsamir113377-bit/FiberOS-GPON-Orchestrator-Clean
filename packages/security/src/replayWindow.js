/**
 * Replay-window and request-binding helpers for the replay-defense boundary.
 *
 * The reservation key already binds a nonce to a canonical context. These
 * helpers close the remaining gaps the reservation alone cannot express:
 *   - a request timestamp that must fall inside an explicit validity window
 *     (stale evidence and future-dated requests are both rejected);
 *   - a body fingerprint so a signature/idempotency key cannot be replayed
 *     against *different* request content;
 *   - explicit binding of the request to subject + tenant + operation.
 */
'use strict';

const crypto = require('node:crypto');

const DEFAULT_WINDOW_SECONDS = 300;
const MAX_WINDOW_SECONDS = 86400;

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function parseReplayTimestamp(value) {
  if (value == null || value === '') throw codedError('REPLAY_TIMESTAMP_REQUIRED');
  let ms = NaN;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw codedError('REPLAY_TIMESTAMP_INVALID');
    ms = Math.abs(value) < 1e11 ? value * 1000 : value;
  } else {
    const text = String(value).trim();
    if (!text) throw codedError('REPLAY_TIMESTAMP_REQUIRED');
    if (/^\d+$/.test(text)) {
      const numeric = Number(text);
      ms = numeric < 1e11 ? numeric * 1000 : numeric;
    } else {
      const parsed = Date.parse(text);
      ms = Number.isNaN(parsed) ? NaN : parsed;
    }
  }
  if (!Number.isFinite(ms)) throw codedError('REPLAY_TIMESTAMP_INVALID');
  return ms;
}

/**
 * Validate a request timestamp against an explicit validity window.
 * Too old  -> REPLAY_TIMESTAMP_EXPIRED
 * Too new  -> REPLAY_TIMESTAMP_IN_FUTURE
 */
function validateReplayTimestamp(value, options) {
  const opts = options || {};
  const now = Number.isFinite(opts.now) ? Number(opts.now) : Date.now();
  const windowSeconds = Number.isInteger(opts.windowSeconds) ? opts.windowSeconds : DEFAULT_WINDOW_SECONDS;
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > MAX_WINDOW_SECONDS) throw codedError('REPLAY_TIMESTAMP_WINDOW_INVALID');
  const futureSkewSeconds = Number.isInteger(opts.futureSkewSeconds) ? opts.futureSkewSeconds : windowSeconds;
  if (futureSkewSeconds < 0 || futureSkewSeconds > MAX_WINDOW_SECONDS) throw codedError('REPLAY_TIMESTAMP_WINDOW_INVALID');
  const at = parseReplayTimestamp(value);
  const ageMs = now - at;
  if (ageMs > windowSeconds * 1000) throw codedError('REPLAY_TIMESTAMP_EXPIRED');
  if (ageMs < -futureSkewSeconds * 1000) throw codedError('REPLAY_TIMESTAMP_IN_FUTURE');
  return Object.freeze({ at, ageMs, windowSeconds, futureSkewSeconds, expiresAt: at + windowSeconds * 1000 });
}

/** Content-bound fingerprint so a key cannot be replayed with a different body. */
function requestFingerprint(body) {
  // Type-tagged so a raw string body can never collide with the JSON encoding of
  // an object body — the same bytes must always mean the same request content.
  let tag;
  let buffer;
  if (body == null) { tag = 'n:'; buffer = Buffer.alloc(0); }
  else if (Buffer.isBuffer(body)) { tag = 'b:'; buffer = body; }
  else if (typeof body === 'string') { tag = 's:'; buffer = Buffer.from(body, 'utf8'); }
  else { tag = 'j:'; buffer = Buffer.from(JSON.stringify(body), 'utf8'); }
  return crypto.createHash('sha256').update(tag, 'utf8').update(buffer).digest('hex');
}

/** Bind the request to subject + tenant + operation (+ optional content). */
function bindReplayContext(input) {
  const source = input || {};
  const subject = String(source.userId == null ? '' : source.userId).trim();
  const operation = String(source.operationType == null ? '' : source.operationType).trim();
  if (!subject) throw codedError('REPLAY_SUBJECT_REQUIRED');
  if (!operation) throw codedError('REPLAY_OPERATION_REQUIRED');
  const tenant = source.tenantId == null || String(source.tenantId).trim() === '' ? 'UNBOUND' : String(source.tenantId).trim();
  return Object.freeze({
    subject,
    tenant,
    operation,
    method: source.method == null ? null : String(source.method).toUpperCase(),
    path: source.path == null ? null : String(source.path),
    bodyFingerprint: source.bodyFingerprint == null ? null : String(source.bodyFingerprint)
  });
}

module.exports = Object.freeze({
  DEFAULT_WINDOW_SECONDS,
  MAX_WINDOW_SECONDS,
  parseReplayTimestamp,
  validateReplayTimestamp,
  requestFingerprint,
  bindReplayContext
});
