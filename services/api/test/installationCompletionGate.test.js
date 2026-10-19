'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  requiredEvidenceTypes,
  normalizeEvidenceType,
  assertCompletionEvidence,
  requiredEvidenceSatisfied,
} = require('../src/routes/installation');

test('required evidence — new installation / migration', () => {
  assert.deepEqual(requiredEvidenceTypes('NEW_INSTALLATION'), ['DROP_CABLE_VIDEO', 'OPTICAL_POWER']);
  assert.deepEqual(requiredEvidenceTypes('MIGRATION'), ['DROP_CABLE_VIDEO', 'OPTICAL_POWER']);
});

test('required evidence — router', () => {
  assert.deepEqual(requiredEvidenceTypes('ROUTER_INSTALLATION'), [
    'ROUTER_LABEL_SCAN',
    'ROUTER_INSTALLATION_VIDEO',
    'OPTICAL_POWER',
  ]);
});

test('normalize aliases', () => {
  assert.equal(normalizeEvidenceType('INSTALLATION_VIDEO'), 'DROP_CABLE_VIDEO');
  assert.equal(normalizeEvidenceType('ROUTER_VIDEO'), 'ROUTER_INSTALLATION_VIDEO');
});

test('completion rejects client-hash under strict default', () => {
  process.env.FIBEROS_ALLOW_CLIENT_HASH_COMPLETION = '';
  assert.throws(
    () => assertCompletionEvidence(
      [{ evidence_type: 'DROP_CABLE_VIDEO', storage_status: 'CLIENT_HASH_ONLY' },
       { evidence_type: 'OPTICAL_POWER', storage_status: 'CLIENT_HASH_ONLY' }],
      'NEW_INSTALLATION'
    ),
    (err) => err.code === 'COMPLETION_EVIDENCE_INCOMPLETE'
  );
});

test('completion accepts STORAGE_VERIFIED full set', () => {
  process.env.FIBEROS_ALLOW_CLIENT_HASH_COMPLETION = '';
  assert.doesNotThrow(() =>
    assertCompletionEvidence(
      [
        { evidence_type: 'DROP_CABLE_VIDEO', storage_status: 'STORAGE_VERIFIED' },
        { evidence_type: 'OPTICAL_POWER', storage_status: 'STORAGE_VERIFIED' },
      ],
      'NEW_INSTALLATION'
    )
  );
});

test('lab flag allows client-hash completion', () => {
  process.env.FIBEROS_ALLOW_CLIENT_HASH_COMPLETION = 'true';
  assert.doesNotThrow(() =>
    assertCompletionEvidence(
      [
        { evidence_type: 'INSTALLATION_VIDEO', storage_status: 'CLIENT_HASH_ONLY' },
        { evidence_type: 'OPTICAL_POWER', storage_status: 'CLIENT_HASH_ONLY' },
      ],
      'NEW_INSTALLATION'
    )
  );
  process.env.FIBEROS_ALLOW_CLIENT_HASH_COMPLETION = '';
});

test('requiredEvidenceSatisfied drives state machine readiness', () => {
  process.env.FIBEROS_ALLOW_CLIENT_HASH_COMPLETION = 'true';
  assert.equal(
    requiredEvidenceSatisfied(
      [
        { evidence_type: 'DROP_CABLE_VIDEO', storage_status: 'CLIENT_HASH_ONLY' },
        { evidence_type: 'OPTICAL_POWER', storage_status: 'CLIENT_HASH_ONLY' },
      ],
      'MIGRATION'
    ),
    true
  );
  process.env.FIBEROS_ALLOW_CLIENT_HASH_COMPLETION = '';
});
