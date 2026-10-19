'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { haversineKm, firstTimeRightScore, feasibleVisit, optimizeRoute, zeroRevisitPlan } = require('../src/index');

test('haversineKm is zero for identical points and positive otherwise', () => {
  assert.equal(haversineKm([30.0, 31.0], [30.0, 31.0]), 0);
  assert.ok(haversineKm([30.0, 31.0], [30.1, 31.1]) > 0);
});

test('firstTimeRightScore bands a perfect visit as zero-revisit likely', () => {
  const r = firstTimeRightScore({ skillMatch: 1, partsOnTruck: 1, accessConfirmed: 1, timeWindowFit: 1, historicalSuccessRate: 1 });
  assert.equal(r.band, 'ZERO_REVISIT_LIKELY');
  assert.equal(r.score, 1);
});

test('feasibleVisit blocks on missing skill, part or window', () => {
  const bad = feasibleVisit({ requiredSkills: ['FUSION'], parts: ['ONT-X'], window: [10, 20] }, { skills: [], inventory: {}, etaMinutes: 30 });
  assert.equal(bad.feasible, false);
  assert.deepEqual(bad.missingSkills, ['FUSION']);
  assert.deepEqual(bad.missingParts, ['ONT-X']);
  assert.equal(bad.windowOk, false);
  const ok = feasibleVisit({ requiredSkills: ['FUSION'], parts: [], window: [10, 40] }, { skills: ['FUSION'], inventory: {}, etaMinutes: 30 });
  assert.equal(ok.feasible, true);
});

test('optimizeRoute returns an ordered, de-duplicated stop list', () => {
  const r = optimizeRoute({ depot: [30.0, 31.0], stops: [ { id: 'A', point: [30.01, 31.01] }, { id: 'B', point: [30.05, 31.05] } ] });
  assert.equal(r.stopOrder.length, 2);
  assert.equal(new Set(r.stopOrder).size, 2);
  assert.ok(r.totalDistanceKm > 0);
});

test('zeroRevisitPlan separates planned from deferred', () => {
  const r = zeroRevisitPlan({
    visits: [ { id: 'V1', requiredSkills: ['A'], parts: [] }, { id: 'V2', requiredSkills: ['Z'], parts: [] } ],
    state: { skills: ['A'], inventory: {} }
  });
  assert.equal(r.planned.length, 1);
  assert.equal(r.deferred.length, 1);
  assert.equal(r.zeroRevisitReady, false);
});
