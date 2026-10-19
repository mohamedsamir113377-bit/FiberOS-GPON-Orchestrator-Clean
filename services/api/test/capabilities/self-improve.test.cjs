'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, initialState, transition, canReach, HUMAN_GATED } = require('../../src/capabilities/self-improve.cjs');

const NOW = Date.parse('2026-10-15T12:00:00Z');
const approval = { approvalId: 'APR-1', approvedBy: 'ops-director', rationale: 'measured regression in p95 latency' };

test('measure -> propose -> review cannot bypass review', () => {
  const s = createStore();
  assert.equal(transition(s, 'measure', 'review', {}, NOW).code, 'ILLEGAL_TRANSITION');
  assert.equal(transition(s, 'measure', 'propose', {}, NOW).state, 'propose');
  assert.equal(transition(s, 'propose', 'review', {}, NOW).state, 'review');
});
test('approval and release require a recorded human decision', () => {
  const s = createStore();
  assert.equal(transition(s, 'review', 'approve', {}, NOW).code, 'HUMAN_APPROVAL_REQUIRED');
  assert.equal(transition(s, 'review', 'approve', { approvalId: 'APR-1', approvedBy: 'x', rationale: 'too short' }, NOW).code, 'HUMAN_APPROVAL_REQUIRED');
  assert.equal(transition(s, 'review', 'approve', approval, NOW).state, 'approve');
  assert.equal(transition(s, 'approve', 'release', {}, NOW).code, 'HUMAN_APPROVAL_REQUIRED');
  assert.equal(transition(s, 'approve', 'release', approval, NOW).state, 'release');
});
test('rejection and rollback are terminal and must state a reason', () => {
  const s = createStore();
  assert.equal(transition(s, 'review', 'reject', {}, NOW).code, 'REASON_REQUIRED');
  assert.equal(transition(s, 'review', 'reject', { reason: 'the proposal lacks a rollback plan' }, NOW).state, 'reject');
  assert.equal(transition(s, 'release', 'rollback', { reason: 'latency regressed again after 20 minutes' }, NOW).state, 'rollback');
  assert.equal(canReach('rollback', 'release'), false);
});
test('every transition is recorded, and human-gated events are declared', () => {
  const s = createStore();
  transition(s, 'measure', 'propose', {}, NOW);
  transition(s, 'propose', 'review', {}, NOW);
  transition(s, 'review', 'approve', approval, NOW);
  transition(s, 'approve', 'release', approval, NOW);
  assert.equal(s.history.length, 4);
  assert.deepEqual(s.history.map((h) => h.to), ['propose', 'review', 'approve', 'release']);
  assert.deepEqual(HUMAN_GATED, ['approve', 'release']);
  assert.equal(initialState(), 'measure');
});
