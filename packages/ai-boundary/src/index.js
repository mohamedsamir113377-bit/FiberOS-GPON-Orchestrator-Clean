'use strict';

const { ENABLE_VARS, INFERENCE_URL_VARS, resolveAiPolicy, assertAiEnabled } = require('./aiPolicy');

/**
 * AI boundary policy — pure domain.
 * AI is an untrusted advisory source. Its output is DATA, never authority.
 */

const FORBIDDEN_ACTIONS = Object.freeze([
  'close_ticket',
  'mutate_topology',
  'southbound_write',
  'append_authoritative_audit',
  'dispatch_assign_final',
  'lift_production_hold'
]);
const MAX_QUESTION_CHARS = 12000;
const MAX_CONTEXT_BYTES = 65536;
const SECRET_KEY = /(authorization|cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key|credential)/i;
const CONTROL_KEY = /^(system|developer|tool|function_call|function_call_output|execute|executionauthorized|authority)$/i;

function isPlainObject(v) {
  return !!v && Object.getPrototypeOf(v) === Object.prototype;
}

function sanitizeData(value, depth = 0, key = '') {
  if (depth > 8) throw Object.assign(new Error('AI_CONTEXT_DEPTH_EXCEEDED'), { code: 'AI_CONTEXT_DEPTH_EXCEEDED' });
  if (key && (SECRET_KEY.test(key) || CONTROL_KEY.test(key))) {
    throw Object.assign(new Error('AI_CONTEXT_CONTROL_OR_SECRET_KEY_REJECTED'), { code: 'AI_CONTEXT_CONTROL_OR_SECRET_KEY_REJECTED' });
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw Object.assign(new Error('AI_CONTEXT_NUMBER_INVALID'), { code: 'AI_CONTEXT_NUMBER_INVALID' });
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => sanitizeData(v, depth + 1));
  if (isPlainObject(value)) {
    const out = Object.create(null);
    for (const [k, v] of Object.entries(value)) {
      if (k.length > 128) throw Object.assign(new Error('AI_CONTEXT_KEY_TOO_LONG'), { code: 'AI_CONTEXT_KEY_TOO_LONG' });
      out[k] = sanitizeData(v, depth + 1, k);
    }
    return out;
  }
  throw Object.assign(new Error('AI_CONTEXT_TYPE_REJECTED'), { code: 'AI_CONTEXT_TYPE_REJECTED' });
}

function normalizeAdvisoryInput(input) {
  input = input || {};
  const question = input.question == null ? '' : String(input.question);
  if (question.length > MAX_QUESTION_CHARS) throw Object.assign(new Error('AI_QUESTION_TOO_LARGE'), { code: 'AI_QUESTION_TOO_LARGE' });
  const context = sanitizeData(input.context == null ? {} : input.context);
  const bytes = Buffer.byteLength(JSON.stringify(context), 'utf8');
  if (bytes > MAX_CONTEXT_BYTES) throw Object.assign(new Error('AI_CONTEXT_TOO_LARGE'), { code: 'AI_CONTEXT_TOO_LARGE' });
  return Object.freeze({
    ticketId: input.ticketId == null ? null : String(input.ticketId),
    question,
    context,
    contextBytes: bytes
  });
}

function validateAdvisoryOutput(output) {
  if (!output || output.executionAuthorized !== false) {
    const e = new Error('AI_EXECUTION_AUTHORITY_VIOLATION');
    e.code = 'AI_EXECUTION_AUTHORITY_VIOLATION';
    throw e;
  }
  if (output.authority !== 'ADVISORY_ONLY') {
    const e = new Error('AI_AUTHORITY_MUST_BE_ADVISORY_ONLY');
    e.code = 'AI_AUTHORITY_MUST_BE_ADVISORY_ONLY';
    throw e;
  }
  if (Array.isArray(output.actions)) {
    for (const action of output.actions) {
      if (isForbiddenAction(action && (action.action || action.type || action.name))) {
        const e = new Error('AI_FORBIDDEN_ACTION_PROPOSAL');
        e.code = 'AI_FORBIDDEN_ACTION_PROPOSAL';
        throw e;
      }
    }
  }
  return true;
}

function buildAdvisoryResponse(input, options) {
  input = input || {};
  options = options || {};
  const enabled = options.aiEnabled === true;
  const upstreamUrl = options.aiUpstreamUrl ? String(options.aiUpstreamUrl) : '';
  const base = {
    ok: true,
    authority: 'ADVISORY_ONLY',
    executionAuthorized: false,
    forbiddenActions: FORBIDDEN_ACTIONS.slice(),
    inputEcho: { ticketId: input.ticketId || null, question: input.question || null }
  };
  if (!enabled) return Object.freeze(Object.assign({}, base, { advice: null, reason: 'AI_DISABLED' }));
  if (!upstreamUrl) return Object.freeze(Object.assign({}, base, { advice: null, reason: 'AI_UPSTREAM_URL_MISSING' }));
  return Object.freeze(Object.assign({}, base, {
    reason: 'UPSTREAM_ADVISORY_ONLY',
    advice: options.upstreamAdvice != null ? options.upstreamAdvice : null
  }));
}

function assertNoExecutionAuthority(response) {
  validateAdvisoryOutput(response);
  return true;
}

function isForbiddenAction(action) {
  return FORBIDDEN_ACTIONS.indexOf(String(action || '')) !== -1;
}

module.exports = {
  FORBIDDEN_ACTIONS,
  ENABLE_VARS,
  INFERENCE_URL_VARS,
  resolveAiPolicy,
  assertAiEnabled,
  MAX_QUESTION_CHARS,
  MAX_CONTEXT_BYTES,
  buildAdvisoryResponse,
  assertNoExecutionAuthority,
  isForbiddenAction,
  normalizeAdvisoryInput,
  validateAdvisoryOutput
};
