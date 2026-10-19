'use strict';

const crypto = require('crypto');
const SECRET_KEY = /(authorization|cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key|credential)/i;
const CONTROL_KEY = /^(system|developer|tool|function_call|function_call_output|execute|executionauthorized|authority)$/i;
const FORBIDDEN_INTENTS = Object.freeze([
  'mutate_authoritative_state',
  'close_ticket',
  'dispatch_assign_final',
  'mutate_topology',
  'lift_production_hold',
  'privileged_sql'
]);

function plainObject(v) { return !!v && Object.getPrototypeOf(v) === Object.prototype; }
function sanitize(value, depth = 0, key = '') {
  if (depth > 8) throw Object.assign(new Error('WEB_AI_CONTEXT_DEPTH_EXCEEDED'), { code: 'WEB_AI_CONTEXT_DEPTH_EXCEEDED' });
  if (key && (SECRET_KEY.test(key) || CONTROL_KEY.test(key))) {
    throw Object.assign(new Error('WEB_AI_CONTEXT_KEY_REJECTED'), { code: 'WEB_AI_CONTEXT_KEY_REJECTED' });
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw Object.assign(new Error('WEB_AI_CONTEXT_NUMBER_INVALID'), { code: 'WEB_AI_CONTEXT_NUMBER_INVALID' });
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  if (plainObject(value)) {
    const out = Object.create(null);
    for (const [k, v] of Object.entries(value)) out[k] = sanitize(v, depth + 1, k);
    return out;
  }
  throw Object.assign(new Error('WEB_AI_CONTEXT_TYPE_REJECTED'), { code: 'WEB_AI_CONTEXT_TYPE_REJECTED' });
}
function stable(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(stable);
  const out = {};
  for (const k of Object.keys(v).sort()) out[k] = stable(v[k]);
  return out;
}
function sha256(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(stable(v));
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}
function createRequest(input = {}) {
  const question = input.question == null ? '' : String(input.question);
  if (!question || question.length > 12000) throw Object.assign(new Error('WEB_AI_QUESTION_INVALID'), { code: 'WEB_AI_QUESTION_INVALID' });
  const context = sanitize(input.context || {});
  return Object.freeze({
    surface: 'WEBSITE_ONLY',
    authority: 'ADVISORY_ONLY',
    executionAuthorized: false,
    question,
    context,
    requestHash: sha256({ question, context })
  });
}
function validateResponse(response) {
  if (!response || response.surface !== 'WEBSITE_ONLY' || response.authority !== 'ADVISORY_ONLY' || response.executionAuthorized !== false) {
    throw Object.assign(new Error('WEB_AI_AUTHORITY_BOUNDARY_VIOLATION'), { code: 'WEB_AI_AUTHORITY_BOUNDARY_VIOLATION' });
  }
  for (const item of response.actions || []) {
    const name = String(item && (item.action || item.type || item.name) || '');
    if (FORBIDDEN_INTENTS.includes(name)) throw Object.assign(new Error('WEB_AI_FORBIDDEN_INTENT'), { code: 'WEB_AI_FORBIDDEN_INTENT' });
  }
  return true;
}
function modelEligibility(spec = {}) {
  const reasons = [];
  if (spec.deploymentAuthority !== 'FIBEROS_SELF_HOSTED') reasons.push('SELF_HOSTED_ONLY');
  if (spec.licenseEvidence !== true) reasons.push('LICENSE_EVIDENCE_REQUIRED');
  if (spec.securityReview !== 'PASS') reasons.push('SECURITY_REVIEW_REQUIRED');
  if (spec.validationEvidence !== true) reasons.push('VALIDATION_EVIDENCE_REQUIRED');
  if (spec.privacyBoundary !== 'NO_EXTERNAL_INFERENCE') reasons.push('EXTERNAL_INFERENCE_FORBIDDEN');
  return Object.freeze({ eligible: reasons.length === 0, reasons });
}
module.exports = { FORBIDDEN_INTENTS, createRequest, validateResponse, modelEligibility, sanitize, sha256 };
