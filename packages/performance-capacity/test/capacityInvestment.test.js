import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCapacityInvestmentScenario
} from '../src/index.js';

test('capacity engine forecasts demand and computes required investment deterministically', () => {
  const scenario = calculateCapacityInvestmentScenario({
    scenarioName: '12-month-growth',
    horizonMonths: 12,
    resources: [{
      id: 'PON-01',
      unit: 'ports',
      currentCapacity: 100,
      currentDemand: 80,
      annualGrowthRate: 0.25,
      monthlyDemandIncrement: 0,
      plannedCapacity: 0,
      bufferCapacity: 0,
      targetUtilization: 0.8,
      unitCostMinor: 1000
    }]
  });

  assert.equal(scenario.calculated, true);
  assert.equal(scenario.autonomousInvestment, false);
  assert.equal(scenario.databaseWrites, 0);
  assert.equal(scenario.resources[0].forecastDemand, 100);
  assert.equal(scenario.resources[0].requiredTotalCapacity, 125);
  assert.equal(scenario.resources[0].additionalCapacity, 25);
  assert.equal(scenario.resources[0].investmentCostMinor, 25000);
  assert.equal(scenario.totals.totalInvestmentCostMinor, 25000);
});

test('capacity engine uses explicit buffer and planned capacity without hidden reserve factors', () => {
  const scenario = calculateCapacityInvestmentScenario({
    scenarioName: 'buffered',
    horizonMonths: 6,
    resources: [{
      id: 'EDGE-01',
      currentCapacity: 120,
      currentDemand: 60,
      annualGrowthRate: 0,
      monthlyDemandIncrement: 2,
      plannedCapacity: 5,
      bufferCapacity: 8,
      targetUtilization: 0.75,
      unitCostMinor: 200
    }]
  });

  assert.equal(scenario.resources[0].forecastDemand, 72);
  assert.equal(scenario.resources[0].requiredTotalCapacity, 107);
  assert.equal(scenario.resources[0].capacityBeforeInvestment, 125);
  assert.equal(scenario.resources[0].additionalCapacity, 0);
  assert.equal(scenario.totals.totalInvestmentCostMinor, 0);
});

test('capacity scenario identity is deterministic and validates unsafe inputs', () => {
  const input = {
    scenarioName: 'deterministic',
    horizonMonths: 3,
    resources: [{
      id: 'X',
      currentCapacity: 10,
      currentDemand: 4,
      annualGrowthRate: 0,
      targetUtilization: 0.8,
      unitCostMinor: 10
    }]
  };
  const a = calculateCapacityInvestmentScenario(input);
  const b = calculateCapacityInvestmentScenario(input);

  assert.equal(a.scenarioId, b.scenarioId);
  assert.throws(() => calculateCapacityInvestmentScenario({
    ...input,
    resources: [{ ...input.resources[0], targetUtilization: 1.2 }]
  }), /targetUtilization/);
  assert.throws(() => calculateCapacityInvestmentScenario({
    ...input,
    resources: [{ ...input.resources[0], unitCostMinor: 1.5 }]
  }), /unitCostMinor/);
});


test('capacity engine fails closed instead of rounding unsafe monetary totals', () => {
  assert.throws(() => calculateCapacityInvestmentScenario({
    scenarioName: 'unsafe-cost',
    horizonMonths: 0,
    resources: [{
      id: 'OVERFLOW',
      currentCapacity: 0,
      currentDemand: 2,
      annualGrowthRate: 0,
      targetUtilization: 1,
      unitCostMinor: Number.MAX_SAFE_INTEGER
    }]
  }), /investmentCostMinor exceeds exact monetary precision/);
});
