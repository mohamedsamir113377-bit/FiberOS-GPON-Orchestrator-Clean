'use strict';
const ID = /^[a-z0-9][a-z0-9-_]{1,63}$/;

function validateGrant(grant) {
  const errors = [];
  if (!grant || typeof grant !== 'object') return { valid: false, errors: ['grant must be an object'] };
  for (const k of ['fromProject', 'toProject', 'resource', 'grantedBy']) {
    if (typeof grant[k] !== 'string' || !ID.test(grant[k])) errors.push(k + ' must match ' + ID);
  }
  if (grant.fromProject && grant.toProject && grant.fromProject === grant.toProject) errors.push('a project cannot be granted access to itself');
  if (grant.expiresAt !== undefined && grant.expiresAt !== null) {
    const t = typeof grant.expiresAt === 'string' ? Date.parse(grant.expiresAt) : NaN;
    if (Number.isNaN(t)) errors.push('expiresAt must be an ISO-8601 timestamp when present');
  }
  return { valid: errors.length === 0, errors };
}
function createGrant(store, grant, nowMs) {
  if (!store || !Array.isArray(store.grants)) throw new TypeError('store.grants must be an array');
  const v = validateGrant(grant);
  if (!v.valid) return { ok: false, code: 'INVALID', errors: v.errors };
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= now) return { ok: false, code: 'INVALID', errors: ['expiresAt is already in the past'] };
  const id = 'gr-' + (store.grants.length + 1);
  store.grants.push({ id, ...grant, createdAt: new Date(now).toISOString(), revokedAt: null });
  return { ok: true, id };
}
// Default deny: project A sees project B only through a live, explicit grant.
function canView(store, fromProject, toProject, resource, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  if (fromProject === toProject) return { allowed: true, reason: 'same project' };
  const hit = store.grants.find((g) => g.fromProject === fromProject && g.toProject === toProject && g.resource === resource && g.revokedAt === null && (!g.expiresAt || Date.parse(g.expiresAt) > now));
  return hit ? { allowed: true, grantId: hit.id, reason: 'explicit grant' } : { allowed: false, reason: 'no live grant for this project pair and resource' };
}
function revokeGrant(store, grantId, revokedBy, nowMs) {
  const g = store.grants.find((x) => x.id === grantId);
  if (!g) return { ok: false, code: 'NOT_FOUND' };
  if (g.revokedAt) return { ok: false, code: 'ALREADY_REVOKED' };
  g.revokedAt = new Date(typeof nowMs === 'number' ? nowMs : Date.now()).toISOString();
  g.revokedBy = revokedBy;
  return { ok: true, id: grantId, effectiveImmediately: true };
}
module.exports = { validateGrant, createGrant, canView, revokeGrant };
