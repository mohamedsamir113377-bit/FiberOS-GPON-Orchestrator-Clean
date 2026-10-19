import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEvidence, assertEvidenceClass, promoteEvidence, truthGate } from '../src/index.js';

test('null evidence is unverified', () => assert.equal(classifyEvidence(null), 'unverified'));
test('client-trusted input is client-declared', () => assert.equal(classifyEvidence({ sourceTrust: 'client' }), 'client_declared'));
test('device receipt is measured only after trusted verification', () => {
  const evidence = { sourceTrust: 'device', measurement: true, receipt: 'r', observedAt: '2026-09-25T12:00:00Z', deviceIdentity: 'd' };
  assert.equal(classifyEvidence(evidence), 'unverified');
  assert.equal(classifyEvidence(evidence, { verifyDeviceReceipt: () => true }), 'measured');
});
test('caller-provided classification cannot self-promote client evidence', () => assert.equal(classifyEvidence({ classification: 'measured', sourceTrust: 'client' }), 'client_declared'));
test('method plus inputs is derived', () => assert.equal(classifyEvidence({ method: 'sum', inputs: ['a', 'b'] }), 'derived'));
test('simulation is classified as simulated', () => assert.equal(classifyEvidence({ simulation: true }), 'simulated'));
test('assertEvidenceClass accepts an allowed observed class', () => assert.equal(assertEvidenceClass({ source: 'field-observation' }, ['observed']), 'observed'));
test('client data cannot self-promote', () => assert.throws(() => promoteEvidence({ sourceTrust: 'client' }, 'measured'), /CLIENT_DATA_CANNOT_SELF_PROMOTE/));
test('simulation cannot self-promote', () => assert.throws(() => promoteEvidence({ simulation: true }, 'measured'), /SIMULATION_CANNOT_SELF_PROMOTE/));
test('truth gate rejects an unaccepted class', () => assert.deepEqual(truthGate({ evidence: { source: 'field-observation' }, requiredClasses: ['measured'] }), { allowed: false, reason: 'EVIDENCE_CLASS_NOT_ACCEPTED', classification: 'observed' }));
