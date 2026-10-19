'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPreventiveMaintenanceSchedule } = require('../src/reliabilityPredictive');

const baseCandidate = {
  assetId: 'OLT-01',
  causes: ['power', 'fiber'],
  priorShape: 1,
  priorRate: 30,
  events: { power: 8, fiber: 2 },
  exposure: 30,
  expectedFailureImpact: 10000,
  preventiveCost: 500,
  actionCost: 100,
  leadTime: 7
};

test('risk-based planner produces a deterministic preventive plan from explicit evidence and costs', () => {
  const out = buildPreventiveMaintenanceSchedule({
    planningTimestamp: '2026-10-08T00:00:00Z',
    planningHorizon: 30,
    candidates: [baseCandidate]
  });

  assert.equal(out.authority, 'DETERMINISTIC_RISK_BASED_PREVENTIVE_PLANNING');
  assert.equal(out.autonomousExecution, false);
  assert.equal(out.databaseWrites, 0);
  assert.equal(out.plannedCount, 1);
  assert.equal(out.schedule[0].status, 'PLAN');
  assert.equal(out.schedule[0].dueAt, '2026-10-31T00:00:00.000Z');
  assert.ok(out.schedule[0].risk.failureProbability > 0.9);
});

test('planner keeps low economic risk in MONITOR state', () => {
  const out = buildPreventiveMaintenanceSchedule({
    planningTimestamp: '2026-10-08T00:00:00Z',
    planningHorizon: 30,
    candidates: [{
      ...baseCandidate,
      assetId: 'ONT-LOW-RISK',
      events: { power: 0, fiber: 0 },
      expectedFailureImpact: 50,
      preventiveCost: 1000,
      actionCost: 50
    }]
  });

  assert.equal(out.plannedCount, 0);
  assert.equal(out.schedule[0].status, 'MONITOR');
  assert.equal(out.schedule[0].dueAt, null);
});

test('planner ordering is deterministic and prioritizes net preventive value', () => {
  const out = buildPreventiveMaintenanceSchedule({
    planningTimestamp: '2026-10-08T00:00:00Z',
    planningHorizon: 30,
    candidates: [
      { ...baseCandidate, assetId: 'B', preventiveCost: 1000 },
      { ...baseCandidate, assetId: 'A', preventiveCost: 200 }
    ]
  });

  assert.deepEqual(out.schedule.map((row) => row.assetId), ['A', 'B']);
});
