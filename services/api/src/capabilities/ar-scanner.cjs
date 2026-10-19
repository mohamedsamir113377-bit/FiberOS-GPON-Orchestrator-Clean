'use strict';
const ROLE_PERMISSIONS = { viewer: [], technician: ['capture'], supervisor: ['capture', 'certify'] };
const ASSET_ID = /^[A-Z0-9][A-Z0-9._-]{2,63}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function authorize(actor, permission) {
  if (!actor || typeof actor.role !== 'string') return { allowed: false, reason: 'actor has no role' };
  const perms = ROLE_PERMISSIONS[actor.role];
  if (!perms) return { allowed: false, reason: 'unknown role: ' + actor.role };
  return { allowed: perms.includes(permission), reason: perms.includes(permission) ? null : 'role ' + actor.role + ' lacks ' + permission };
}
// Field-capture contract: what an AR/mobile client must send, validated server-side.
function validateCapture(payload, nowMs) {
  const errors = [];
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  if (!payload || typeof payload !== 'object') return { valid: false, errors: ['payload must be an object'] };
  if (typeof payload.assetId !== 'string' || !ASSET_ID.test(payload.assetId)) errors.push('assetId must match ' + ASSET_ID);
  if (typeof payload.lat !== 'number' || Number.isNaN(payload.lat) || payload.lat < -90 || payload.lat > 90) errors.push('lat out of range');
  if (typeof payload.lng !== 'number' || Number.isNaN(payload.lng) || payload.lng < -180 || payload.lng > 180) errors.push('lng out of range');
  if (typeof payload.accuracyM !== 'number' || !(payload.accuracyM > 0) || payload.accuracyM > 100) errors.push('accuracyM must be >0 and <=100');
  if (typeof payload.photoSha256 !== 'string' || !SHA256_HEX.test(payload.photoSha256)) errors.push('photoSha256 must be 64 lowercase hex chars');
  const ts = typeof payload.capturedAt === 'string' ? Date.parse(payload.capturedAt) : NaN;
  if (Number.isNaN(ts)) errors.push('capturedAt must be an ISO-8601 timestamp');
  else if (ts > now + MAX_FUTURE_SKEW_MS) errors.push('capturedAt is in the future beyond allowed clock skew');
  return { valid: errors.length === 0, errors };
}
// Idempotent registration: the same assetId + photo hash never creates a second record.
function registerCapture(store, actor, payload, nowMs) {
  if (!store || !Array.isArray(store.captures)) throw new TypeError('store.captures must be an array');
  const auth = authorize(actor, 'capture');
  if (!auth.allowed) return { ok: false, code: 'FORBIDDEN', reason: auth.reason };
  const check = validateCapture(payload, nowMs);
  if (!check.valid) return { ok: false, code: 'INVALID', errors: check.errors };
  const existing = store.captures.find((c) => c.assetId === payload.assetId && c.photoSha256 === payload.photoSha256);
  if (existing) return { ok: true, created: false, id: existing.id, duplicate: true };
  const record = {
    id: 'cap-' + (store.captures.length + 1), assetId: payload.assetId, lat: payload.lat, lng: payload.lng,
    accuracyM: payload.accuracyM, photoSha256: payload.photoSha256, capturedAt: payload.capturedAt,
    capturedBy: actor.id, certified: false,
  };
  store.captures.push(record);
  return { ok: true, created: true, id: record.id, duplicate: false };
}
function certifyCapture(store, actor, id) {
  const auth = authorize(actor, 'certify');
  if (!auth.allowed) return { ok: false, code: 'FORBIDDEN', reason: auth.reason };
  const rec = store.captures.find((c) => c.id === id);
  if (!rec) return { ok: false, code: 'NOT_FOUND' };
  rec.certified = true;
  return { ok: true, id };
}
module.exports = { authorize, validateCapture, registerCapture, certifyCapture, ROLE_PERMISSIONS };
