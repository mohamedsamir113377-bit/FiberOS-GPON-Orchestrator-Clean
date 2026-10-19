'use strict';
const TRANSITIONS = {
  measure: ['propose'],
  propose: ['review'],
  review: ['approve', 'reject'],
  approve: ['release'],
  release: ['rollback'],
  rollback: [],
  reject: [],
};
const HUMAN_GATED = ['approve', 'release'];
function createStore() { return { history: [] }; }
function initialState() { return 'measure'; }
function transition(store, state, event, context, nowMs) {
  const allowed = TRANSITIONS[state];
  if (!allowed) return { ok: false, code: 'UNKNOWN_STATE', state };
  if (!allowed.includes(event)) return { ok: false, code: 'ILLEGAL_TRANSITION', state, event, allowed };
  const ctx = context || {};
  if (HUMAN_GATED.includes(event)) {
    if (typeof ctx.approvalId !== 'string' || ctx.approvalId.trim() === '') return { ok: false, code: 'HUMAN_APPROVAL_REQUIRED', reason: event + ' needs a recorded human approval id' };
    if (typeof ctx.approvedBy !== 'string' || ctx.approvedBy.trim() === '') return { ok: false, code: 'HUMAN_APPROVAL_REQUIRED', reason: event + ' needs the approving identity' };
    if (typeof ctx.rationale !== 'string' || ctx.rationale.trim().length < 10) return { ok: false, code: 'HUMAN_APPROVAL_REQUIRED', reason: event + ' needs a rationale of at least 10 characters' };
  }
  if (event === 'reject' && (typeof ctx.reason !== 'string' || ctx.reason.trim().length < 10)) return { ok: false, code: 'REASON_REQUIRED' };
  if (event === 'rollback' && (typeof ctx.reason !== 'string' || ctx.reason.trim().length < 10)) return { ok: false, code: 'REASON_REQUIRED' };
  const next = event === 'reject' ? 'reject' : event === 'rollback' ? 'rollback' : event;
  store.history.push({ at: new Date(typeof nowMs === 'number' ? nowMs : Date.now()).toISOString(), from: state, event, to: next, approvalId: ctx.approvalId || null, by: ctx.approvedBy || ctx.by || null });
  return { ok: true, from: state, event, state: next };
}
function canReach(state, event) { return Boolean(TRANSITIONS[state] && TRANSITIONS[state].includes(event)); }
module.exports = { TRANSITIONS, HUMAN_GATED, createStore, initialState, transition, canReach };
