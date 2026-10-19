/**
 * Full ticket lifecycle orchestration — pure validation of multi-step paths.
 * Canonical happy path:
 *   pending → in_progress → awaiting_evidence → manager_review → completed
 * Field close lands on awaiting_evidence (evidence already validated separately).
 */
'use strict';

const { canTransition, assertNotDirectClose, normalizeStatus, EDGES, STATUSES } =
  require('./ticketStateMachine');

const CANONICAL_HAPPY_PATH = Object.freeze([
  'pending',
  'in_progress',
  'awaiting_evidence',
  'manager_review',
  'completed'
]);

/** Roles typically allowed to request each transition (server still enforces RLS). */
const TRANSITION_ROLE_HINT = Object.freeze({
  'pending>in_progress': Object.freeze(['field_tech', 'dispatcher', 'ops_manager', 'sysadmin']),
  'in_progress>awaiting_evidence': Object.freeze(['field_tech', 'ops_manager', 'sysadmin']),
  'awaiting_evidence>manager_review': Object.freeze(['field_tech', 'qc', 'ops_manager', 'sysadmin']),
  'manager_review>completed': Object.freeze(['ops_manager', 'qc', 'sysadmin', 'area_supervisor']),
  'manager_review>rejected': Object.freeze(['ops_manager', 'qc', 'sysadmin']),
  'pending>completed': Object.freeze([]) // always forbidden
});

function roleMayRequest(from, to, role) {
  const key = normalizeStatus(from) + '>' + normalizeStatus(to);
  const allowed = TRANSITION_ROLE_HINT[key];
  if (allowed && allowed.length === 0) return { ok: false, reason: 'TRANSITION_FORBIDDEN' };
  if (!allowed) {
    /* edge exists in SM but no hint → allow structurally; server RLS is final */
    const edge = canTransition(from, to);
    return edge.ok
      ? { ok: true, reason: 'EDGE_OK_ROLE_HINT_OPEN' }
      : { ok: false, reason: edge.reason, allowed: edge.allowed };
  }
  /*
   * SECURITY FIX (was fail-open): a missing/unknown role used to default to
   * ok:true with a "warned" flag, trusting an unverified caller (or a
   * downstream RLS layer that does not actually encode this per-transition
   * role table) to catch it. That is a silent bypass for any transition
   * guarded by TRANSITION_ROLE_HINT. Fail closed instead: a role-restricted
   * transition requires a known, verified role.
   */
  if (!role) return { ok: false, reason: 'ROLE_REQUIRED_FOR_TRANSITION', allowedRoles: allowed.slice() };
  if (allowed.indexOf(String(role)) === -1) {
    return { ok: false, reason: 'ROLE_NOT_PERMITTED_FOR_TRANSITION', role: role, allowedRoles: allowed.slice() };
  }
  return { ok: true, reason: 'ROLE_HINT_OK' };
}

function step(from, to, opts) {
  opts = opts || {};
  const edge = assertNotDirectClose(from, to);
  if (!edge.ok) return { ok: false, stage: 'edge', error: edge };
  const t = canTransition(from, to);
  if (!t.ok) return { ok: false, stage: 'edge', error: t };
  const role = roleMayRequest(from, to, opts.role);
  if (!role.ok) return { ok: false, stage: 'role', error: role };
  return {
    ok: true,
    from: normalizeStatus(from),
    to: normalizeStatus(to),
    roleCheck: role
  };
}

/** Validate an ordered path of statuses */
function validatePath(statuses, opts) {
  opts = opts || {};
  const list = (statuses || []).map(normalizeStatus);
  const steps = [];
  for (var i = 0; i < list.length - 1; i++) {
    const s = step(list[i], list[i + 1], opts);
    steps.push(s);
    if (!s.ok) {
      return { ok: false, failedAt: i, steps: steps };
    }
  }
  return { ok: true, steps: steps, path: list };
}

function validateCanonicalHappyPath(opts) {
  return validatePath(CANONICAL_HAPPY_PATH, opts);
}

/** Illegal samples that must always fail */
function illegalSamples() {
  return [
    step('pending', 'completed'),
    step('pending', 'manager_review'),
    step('completed', 'in_progress'),
    step('awaiting_evidence', 'completed')
  ];
}

module.exports = {
  CANONICAL_HAPPY_PATH,
  TRANSITION_ROLE_HINT,
  step,
  validatePath,
  validateCanonicalHappyPath,
  illegalSamples,
  roleMayRequest
};
