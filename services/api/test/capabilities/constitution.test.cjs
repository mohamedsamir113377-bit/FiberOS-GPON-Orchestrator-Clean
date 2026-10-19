'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, propose, approve, enact, auditTrail, hashOf } = require('../../src/capabilities/constitution.cjs');

const policy = { id: 'ops-policy', version: '1.0.0', rules: [
  { statement: 'No production migration without an approved change record.', enforcement: 'release-admission-gate' },
]};
const NOW = Date.parse('2026-10-15T11:00:00Z');

test('a policy cannot take effect without a recorded approval', () => {
  const s = createStore();
  const p = propose(s, policy, 'author-a', NOW);
  assert.equal(enact(s, p.revisionId, 'ops-admin', NOW).code, 'NOT_APPROVED');
});
test('the proposer cannot approve their own revision', () => {
  const s = createStore();
  const p = propose(s, policy, 'author-a', NOW);
  assert.equal(approve(s, p.revisionId, 'author-a', NOW).code, 'SELF_APPROVAL_FORBIDDEN');
  assert.equal(approve(s, p.revisionId, 'reviewer-b', NOW).ok, true);
  assert.equal(enact(s, p.revisionId, 'ops-admin', NOW).status, 'enacted');
});
test('a policy altered after approval is refused', () => {
  const s = createStore();
  const p = propose(s, policy, 'author-a', NOW);
  approve(s, p.revisionId, 'reviewer-b', NOW);
  s.proposals[0].policy.rules.push({ statement: 'Silently allow anything.', enforcement: 'none' });
  assert.equal(enact(s, p.revisionId, 'ops-admin', NOW).code, 'HASH_MISMATCH');
});
test('invalid policies are rejected and every decision is audited', () => {
  const s = createStore();
  assert.equal(propose(s, { id: 'x', version: 'nope', rules: [] }, 'a', NOW).code, 'INVALID');
  const p = propose(s, policy, 'a', NOW);
  approve(s, p.revisionId, 'b', NOW);
  enact(s, p.revisionId, 'c', NOW);
  assert.deepEqual(auditTrail(s).map((a) => a.action), ['propose', 'approve', 'enact']);
  assert.equal(hashOf(policy).length, 64);
});
