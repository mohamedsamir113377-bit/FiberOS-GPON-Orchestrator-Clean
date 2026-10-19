'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { WORKFLOW, MANDATORY_GATES, allowedTransition, canClose, activationPrerequisites } = require('../src');

test('enterprise FTTH workflow permits only declared transitions', () => {
  assert.equal(allowedTransition('planned', 'ready'), true);
  assert.equal(allowedTransition('planned', 'closed'), false);
  assert.equal(allowedTransition('closed', 'ready'), false);
  assert.deepEqual(WORKFLOW.closed, []);
});

test('enterprise FTTH closure requires every mandatory gate', () => {
  assert.equal(canClose({ status: 'accepted', gates: MANDATORY_GATES.map((gate_type) => ({ gate_type, status: 'passed' })) }), true);
  assert.equal(canClose({ status: 'accepted', gates: [{ gate_type: 'design', status: 'passed' }] }), false);
  assert.equal(canClose({ status: 'closed', gates: MANDATORY_GATES.map((gate_type) => ({ gate_type, status: 'passed' })) }), false);
});

test('activation prerequisites are explicit and default false', () => {
  assert.deepEqual(activationPrerequisites(), { drop: false, ont: false, router: false, optical: false });
  assert.deepEqual(activationPrerequisites([{ event_type: 'ont_installed' }, { event_type: 'optical_tested' }]), { drop: false, ont: true, router: false, optical: true });
});
