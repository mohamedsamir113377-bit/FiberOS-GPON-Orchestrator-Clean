'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assessEvidence, assessDecisionSafety } = require('../src/decisionSafety');

test('mixed simulated + real evidence requires a real fresh evidence item', () => {
  const result = assessEvidence({
    evidence: [
      { id: 'real-1', source: 'manual_entry', observedAt: '2026-09-26T16:00:00Z' },
      { id: 'sim-1', source: 'ai_simulated', observedAt: '2099-01-01T00:00:00Z' }
    ],
    now: '2026-09-26T17:00:00Z',
    maxAgeSeconds: 7200
  });
  assert.equal(result.status, 'PROVEN');
});

test('simulated-only evidence fails closed', () => {
  const result = assessEvidence({
    evidence: [{ id: 'sim-1', source: 'ai_simulated', observedAt: '2099-01-01T00:00:00Z' }],
    now: '2026-09-26T17:00:00Z',
    maxAgeSeconds: 7200
  });
  assert.deepEqual(result, {
    status: 'BLOCKED',
    reason: 'SIMULATED_ONLY',
    fresh: false,
    count: 1
  });
});

test('decision safety requires explicit freshness policy', () => {
  const result = assessDecisionSafety({
    evidence: [{ id: 'e1', source: 'manual_entry', observedAt: '2026-09-26T16:00:00Z' }],
    confidence: 0.99,
    riskScore: 0.01,
    capabilityOk: true,
    policyOk: true,
    autonomousAllowed: true,
    rollbackPossible: true,
    rollbackPlan: { rollbackVerified: true },
    now: '2026-09-26T17:00:00Z'
  });
  assert.equal(result.state, 'REQUIRES_HUMAN_APPROVAL');
  assert.equal(result.reason, 'EVIDENCE_FRESHNESS_POLICY_REQUIRED');
});
