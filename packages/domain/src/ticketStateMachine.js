/**
 * FiberOS ticket state machine — pure functions, no I/O.
 * Server CHECK + RPC remain authoritative; this mirrors allowed edges for UX/validation.
 */
'use strict';

const STATUSES = Object.freeze([
  'pending',
  'in_progress',
  'completed',
  'faulty',
  'rejected',
  'manager_review',
  'pending_signature',
  'awaiting_evidence',
  'compensating',
  'cancelled'
]);

/** Directed edges: from → allowed to[] */
const EDGES = Object.freeze({
  pending: Object.freeze(['in_progress', 'cancelled', 'rejected']),
  in_progress: Object.freeze(['awaiting_evidence', 'faulty', 'cancelled', 'manager_review']),
  awaiting_evidence: Object.freeze(['manager_review', 'in_progress', 'faulty', 'cancelled']),
  manager_review: Object.freeze(['completed', 'rejected', 'in_progress', 'pending_signature']),
  pending_signature: Object.freeze(['completed', 'manager_review', 'rejected']),
  compensating: Object.freeze(['in_progress', 'manager_review', 'cancelled']),
  completed: Object.freeze([]),
  faulty: Object.freeze(['in_progress', 'cancelled']),
  rejected: Object.freeze([]),
  cancelled: Object.freeze([])
});

function normalizeStatus(s) {
  return String(s || '').trim().toLowerCase().replace(/-/g, '_');
}

function canTransition(from, to) {
  const f = normalizeStatus(from);
  const t = normalizeStatus(to);
  if (!STATUSES.includes(f) || !STATUSES.includes(t)) {
    return { ok: false, reason: 'UNKNOWN_STATUS', from: f, to: t };
  }
  if (f === t) return { ok: true, reason: 'NOOP', from: f, to: t };
  const allowed = EDGES[f] || [];
  if (allowed.indexOf(t) === -1) {
    return { ok: false, reason: 'ILLEGAL_TRANSITION', from: f, to: t, allowed: allowed.slice() };
  }
  return { ok: true, reason: 'ALLOWED', from: f, to: t };
}

/** Direct pending → completed must always fail in this machine */
function assertNotDirectClose(from, to) {
  const r = canTransition(from, to);
  if (normalizeStatus(from) === 'pending' && normalizeStatus(to) === 'completed') {
    return { ok: false, reason: 'DIRECT_CLOSE_FORBIDDEN' };
  }
  return r;
}

module.exports = {
  STATUSES,
  EDGES,
  canTransition,
  assertNotDirectClose,
  normalizeStatus
};

// Browser global when loaded without bundler
if (typeof window !== 'undefined') {
  window.FiberOSDomain = window.FiberOSDomain || {};
  window.FiberOSDomain.TicketStateMachine = {
    STATUSES, EDGES, canTransition, assertNotDirectClose, normalizeStatus
  };
}
