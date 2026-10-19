'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/entitlementEngine');

describe('entitlement & usage engine', () => {
  it('evaluates unlimited and hard-breached metrics without inventing limits', () => {
    const unlimited = E.evaluateMetricEntitlement({
      metricCode: 'api.calls.period',
      limitValue: null,
      usedValue: 999999
    });
    assert.equal(unlimited.unlimited, true);
    assert.equal(unlimited.status, 'unlimited');
    assert.equal(unlimited.hardBreached, false);

    const limited = E.evaluateMetricEntitlement({
      metricCode: 'reports.period',
      limitValue: 10,
      usedValue: 12,
      hardEnforce: true
    });
    assert.equal(limited.hardBreached, true);
    assert.equal(limited.overBy, 2);
    assert.equal(limited.status, 'over_limit');
  });

  it('authorizes usage fail-closed when metric not on plan', () => {
    const denied = E.authorizeUsage({
      entitlements: [{ metricCode: 'reports.period', limitValue: 5 }],
      usageByMetric: { 'reports.period': 1 },
      metricCode: 'api.calls.period',
      proposedDelta: 1
    });
    assert.equal(denied.allowed, false);
    assert.equal(denied.reason, 'METRIC_NOT_ENTITLED');
  });

  it('blocks hard over-limit and allows under limit', () => {
    const ents = [{ metricCode: 'work_items.period', limitValue: 100, hardEnforce: true }];
    const ok = E.authorizeUsage({
      entitlements: ents,
      usageByMetric: { 'work_items.period': 90 },
      metricCode: 'work_items.period',
      proposedDelta: 5
    });
    assert.equal(ok.allowed, true);

    const bad = E.authorizeUsage({
      entitlements: ents,
      usageByMetric: { 'work_items.period': 98 },
      metricCode: 'work_items.period',
      proposedDelta: 5
    });
    assert.equal(bad.allowed, false);
    assert.equal(bad.reason, 'OVER_LIMIT');
  });

  it('sums ledger deltas for a period only', () => {
    const total = E.sumUsageDeltas(
      [
        { metricCode: 'reports.period', periodKey: '2026-10', delta: 3 },
        { metricCode: 'reports.period', periodKey: '2026-10', delta: 2 },
        { metricCode: 'reports.period', periodKey: '2026-09', delta: 99 },
        { metricCode: 'api.calls.period', periodKey: '2026-10', delta: 7 }
      ],
      'reports.period',
      '2026-10'
    );
    assert.equal(total, 5);
  });

  it('builds plan snapshot with blocked metrics', () => {
    const snap = E.evaluatePlanEntitlements({
      entitlements: [
        { metricCode: 'reports.period', limitValue: 10 },
        { metricCode: 'api.calls.period', limitValue: null }
      ],
      usageByMetric: { 'reports.period': 11, 'api.calls.period': 5000 }
    });
    assert.equal(snap.allowed, false);
    assert.deepEqual(snap.blockedMetrics, ['reports.period']);
  });
});

describe('service order FSM', () => {
  it('allows only declared transitions', () => {
    assert.equal(E.canTransitionOrder('draft', 'submitted'), true);
    assert.equal(E.canTransitionOrder('draft', 'accepted_closed'), false);
    assert.throws(() => E.assertOrderTransition('cancelled', 'draft'), /SERVICE_ORDER_TRANSITION_INVALID/);
  });
});

describe('SLA clocks from documented events', () => {
  it('marks unknown when start clock missing and never invents ETA', () => {
    const out = E.evaluateSlaClocks({
      contract: { responseMinutes: 60 },
      events: []
    });
    assert.equal(out.response.status, 'unknown');
    assert.equal(out.response.reason, 'START_CLOCK_MISSING');
  });

  it('evaluates response breach from event timestamps only', () => {
    const out = E.evaluateSlaClocks({
      contract: { responseMinutes: 30 },
      events: [
        { clockKind: 'detected', occurredAt: '2026-10-08T08:00:00Z', evidenceClass: 'observed' },
        { clockKind: 'responded', occurredAt: '2026-10-08T08:45:00Z', evidenceClass: 'observed' }
      ]
    });
    assert.equal(out.response.status, 'breached');
    assert.equal(out.response.breached, true);
    assert.equal(out.response.elapsedMinutes, 45);
  });
});
