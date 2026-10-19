'use strict';
const crypto = require('crypto');
const REQUIRED_APPROVALS = 1;

function hashOf(policy) {
  const canonical = JSON.stringify({ id: policy.id, version: policy.version, rules: policy.rules });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}
function validatePolicy(policy) {
  const errors = [];
  if (!policy || typeof policy !== 'object') return { valid: false, errors: ['policy must be an object'] };
  if (typeof policy.id !== 'string' || policy.id.trim() === '') errors.push('id is required');
  if (typeof policy.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(policy.version)) errors.push('version must be semver');
  if (!Array.isArray(policy.rules) || policy.rules.length === 0) errors.push('rules must be a non-empty array');
  else policy.rules.forEach((r, i) => {
    if (!r || typeof r.statement !== 'string' || r.statement.trim().length < 10) errors.push('rule #' + i + ': statement too short');
    if (!r || typeof r.enforcement !== 'string' || r.enforcement.trim() === '') errors.push('rule #' + i + ': enforcement is required');
  });
  return { valid: errors.length === 0, errors };
}
function createStore() { return { proposals: [], audit: [] }; }
function log(store, action, actor, detail, nowMs) {
  store.audit.push({ seq: store.audit.length + 1, action, actor, detail: detail || null, at: new Date(typeof nowMs === 'number' ? nowMs : Date.now()).toISOString() });
}
function propose(store, policy, actor, nowMs) {
  const v = validatePolicy(policy);
  if (!v.valid) return { ok: false, code: 'INVALID', errors: v.errors };
  if (typeof actor !== 'string' || actor.trim() === '') return { ok: false, code: 'INVALID', errors: ['actor is required'] };
  const revision = { id: 'pol-' + (store.proposals.length + 1), policy, hash: hashOf(policy), proposedBy: actor, approvals: [], status: 'proposed' };
  store.proposals.push(revision);
  log(store, 'propose', actor, revision.id, nowMs);
  return { ok: true, revisionId: revision.id, hash: revision.hash, status: 'proposed' };
}
// Separation of duties: the proposer cannot approve their own revision.
function approve(store, revisionId, approver, nowMs) {
  const rev = store.proposals.find((p) => p.id === revisionId);
  if (!rev) return { ok: false, code: 'NOT_FOUND' };
  if (rev.status !== 'proposed') return { ok: false, code: 'NOT_PROPOSED' };
  if (approver === rev.proposedBy) return { ok: false, code: 'SELF_APPROVAL_FORBIDDEN', reason: 'a proposer cannot approve their own policy revision' };
  if (rev.approvals.includes(approver)) return { ok: false, code: 'DUPLICATE_APPROVAL' };
  rev.approvals.push(approver);
  if (rev.approvals.length >= REQUIRED_APPROVALS) rev.status = 'approved';
  log(store, 'approve', approver, revisionId, nowMs);
  return { ok: true, revisionId, status: rev.status, approvals: rev.approvals.length };
}
function enact(store, revisionId, actor, nowMs) {
  const rev = store.proposals.find((p) => p.id === revisionId);
  if (!rev) return { ok: false, code: 'NOT_FOUND' };
  if (rev.status !== 'approved') return { ok: false, code: 'NOT_APPROVED', reason: 'policy cannot take effect without a recorded approval' };
  if (hashOf(rev.policy) !== rev.hash) return { ok: false, code: 'HASH_MISMATCH', reason: 'policy changed after approval' };
  rev.status = 'enacted'; rev.enactedAt = new Date(typeof nowMs === 'number' ? nowMs : Date.now()).toISOString();
  log(store, 'enact', actor, revisionId, nowMs);
  return { ok: true, revisionId, status: 'enacted', hash: rev.hash };
}
function auditTrail(store) { return store.audit.slice(); }
module.exports = { hashOf, validatePolicy, createStore, propose, approve, enact, auditTrail, REQUIRED_APPROVALS };
