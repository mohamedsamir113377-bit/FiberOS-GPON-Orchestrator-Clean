'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ebitda, forecastRevenue, breakEven, unitEconomics, dcf, covenantCheck } = require('../src/index');

test('ebitda derives gross profit, margin and EBITDA from ledger inputs', () => {
  const r = ebitda({ revenue: 1000, costOfRevenue: 400, opex: 300 });
  assert.equal(r.grossProfit, 600);
  assert.equal(r.ebitda, 300);
  assert.equal(r.ebitdaMargin, 0.3);
  assert.equal(r.authority, 'LEDGER_DERIVED');
});

test('forecastRevenue applies CAGR and returns requested horizon', () => {
  const r = forecastRevenue({ history: [100, 110, 121], periods: 2, method: 'CAGR' });
  assert.equal(r.projected.length, 2);
  assert.ok(Math.abs(r.growthRate - 0.1) < 1e-9);
  assert.ok(Math.abs(r.projected[1] - 146.41) < 1e-4);
});

test('breakEven refuses non-positive contribution margin', () => {
  const bad = breakEven({ fixedCosts: 1000, pricePerUnit: 10, variableCostPerUnit: 12 });
  assert.equal(bad.feasible, false);
  const ok = breakEven({ fixedCosts: 1000, pricePerUnit: 20, variableCostPerUnit: 10 });
  assert.equal(ok.breakEvenUnits, 100);
  assert.equal(ok.breakEvenRevenue, 2000);
});

test('unitEconomics computes LTV, payback and ratio', () => {
  const r = unitEconomics({ arpu: 50, monthlyChurnRate: 0.02, grossMarginPct: 0.8, cac: 200 });
  assert.ok(Math.abs(r.lifetimeMonths - 50) < 1e-9);
  assert.ok(Math.abs(r.ltv - 2000) < 1e-6);
  assert.ok(Math.abs(r.paybackMonths - 5) < 1e-9);
});

test('dcf values cash flows with terminal value', () => {
  const r = dcf({ cashFlows: [100, 110, 121], discountRate: 0.1, terminalGrowth: 0.02 });
  assert.ok(r.enterpriseValue > r.presentValue);
  assert.ok(Number.isFinite(r.terminalValue));
});

test('covenantCheck flags breaches', () => {
  const r = covenantCheck({ ebitda: 100, totalDebt: 500, interestExpense: 20, thresholds: { maxLeverage: 4, minCoverage: 3 } });
  assert.deepEqual(r.breaches, ['LEVERAGE_EXCEEDED']);
  assert.equal(r.compliant, false);
});
