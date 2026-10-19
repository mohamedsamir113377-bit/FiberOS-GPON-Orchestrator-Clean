'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/contractorWorkPackageEngine');
const { evaluateSlaClocks } = require('../src/entitlementEngine');

describe('contractor work package FSM', () => {
  it('allows assigned → in_progress and rejects closed → assigned', () => {
    assert.equal(C.canTransitionWorkPackage('assigned', 'in_progress'), true);
    assert.equal(C.canTransitionWorkPackage('closed', 'assigned'), false);
    assert.throws(() => C.assertWorkPackageTransition('accepted', 'in_progress'), /WORK_PACKAGE_TRANSITION_INVALID/);
  });
});

describe('measurement segregation of duties', () => {
  it('rejects same actor as measurer and verifier', () => {
    assert.throws(
      () =>
        C.assertMeasurementSegregation({
          measuredBy: 'user-a',
          verifiedBy: 'user-a',
          targetStatus: 'approved'
        }),
      /SEPARATION_OF_DUTIES/
    );
  });

  it('allows independent checker', () => {
    assert.equal(
      C.assertMeasurementSegregation({
        measuredBy: 'user-a',
        verifiedBy: 'user-b',
        targetStatus: 'approved'
      }),
      true
    );
  });
});

describe('commercial reconciliation rules', () => {
  it('requires provider evidence for payment_reconciled', () => {
    assert.throws(
      () =>
        C.assertReconciliationRules({
          makerId: 'm1',
          checkerId: 'c1',
          status: 'payment_reconciled',
          providerPaymentRef: null,
          providerEvidenceClass: 'provider_callback'
        }),
      /PROVIDER_EVIDENCE_REQUIRED/
    );
  });

  it('accepts reconciled with provider callback evidence', () => {
    assert.equal(
      C.assertReconciliationRules({
        makerId: 'm1',
        checkerId: 'c1',
        status: 'payment_reconciled',
        providerPaymentRef: 'pay_abc_123',
        providerEvidenceClass: 'provider_callback'
      }),
      true
    );
  });
});

describe('measurement amount', () => {
  it('computes minor units without float drift', () => {
    assert.equal(C.computeMeasurementAmountMinor(12.5, 100), 1250);
    assert.equal(C.computeMeasurementAmountMinor(1, 999), 999);
  });
});

describe('SLA threshold detection', () => {
  it('emits breach_risk at 80% and breached at 100% without inventing ETA', () => {
    const evaluation = evaluateSlaClocks({
      contract: { responseMinutes: 100 },
      events: [
        { clockKind: 'detected', occurredAt: '2026-10-08T08:00:00Z', evidenceClass: 'observed' }
      ],
      now: new Date('2026-10-08T09:25:00Z')
    });
    // 85 minutes elapsed of 100 → breach_risk
    const thresholds = C.detectAllSlaThresholds(evaluation);
    assert.ok(thresholds.some((t) => t.clockKind === 'response' && t.state === 'breach_risk'));
  });
});
