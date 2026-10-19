'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normInv, eoq, safetyStock, classifyABC, classifyXYZ, forecastDemand } = require('../src/index');

test('normInv matches known z-scores', () => {
  assert.ok(Math.abs(normInv(0.5)) < 1e-9);
  assert.ok(Math.abs(normInv(0.95) - 1.6448536) < 1e-4);
  assert.ok(Math.abs(normInv(0.975) - 1.959964) < 1e-4);
});

test('eoq is positive and cost is finite', () => {
  const r = eoq({ annualDemand: 10000, orderCost: 50, holdingCostPerUnit: 4 });
  assert.ok(r.eoqUnits > 0);
  assert.ok(Number.isFinite(r.totalCost));
});

test('safetyStock grows with service level', () => {
  const a = safetyStock({ serviceLevel: 0.9, demandStdDev: 10, leadTimeDays: 4, demandMeanPerDay: 20 });
  const b = safetyStock({ serviceLevel: 0.99, demandStdDev: 10, leadTimeDays: 4, demandMeanPerDay: 20 });
  assert.ok(b.safetyStockUnits > a.safetyStockUnits);
  assert.ok(a.reorderPoint > 0);
});

test('classifyABC assigns A/B/C by cumulative value', () => {
  const r = classifyABC([{ id: 'a', annualValue: 800 }, { id: 'b', annualValue: 150 }, { id: 'c', annualValue: 50 }]);
  assert.equal(r[0].class, 'A');
  assert.equal(r[2].class, 'C');
});

test('classifyXYZ bands by coefficient of variation', () => {
  assert.equal(classifyXYZ([10, 10, 10, 10]).class, 'X');
  assert.equal(classifyXYZ([1, 10, 1, 10]).class, 'Z');
});

test('forecastDemand produces the requested horizon', () => {
  const r = forecastDemand({ series: [100, 110, 120], periods: 3, alpha: 0.5 });
  assert.equal(r.forecast.length, 3);
});
