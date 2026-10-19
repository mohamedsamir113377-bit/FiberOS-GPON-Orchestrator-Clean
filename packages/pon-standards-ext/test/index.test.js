'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../src/index');

test('generation lookup', () => {
  assert.equal(p.generation('G.9807.1').name, 'XGS-PON');
  assert.throws(() => p.generation('NOPE'));
});

test('budget class XGS N1 window', () => {
  const c = p.budgetClass('G.9807.1', 'N1');
  assert.equal(c.minDb, 14);
  assert.equal(c.maxDb, 29);
});

test('under-min without attenuator is blocked', () => {
  const r = p.validateLinkBudget({ code: 'G.9807.1', className: 'N1', totalLossDb: 10 });
  assert.equal(r.decision, 'BLOCKED_REQUIRES_ATTENUATOR_EVIDENCE');
  assert.equal(r.underMin, true);
});

test('under-min with attenuator evidence passes', () => {
  const r = p.validateLinkBudget({
    code: 'G.9807.1', className: 'N1', totalLossDb: 10, attenuatorDocumented: true
  });
  assert.equal(r.decision, 'PASS_WITH_ATTENUATOR');
});

test('G.657 units: radius is mm, macrobend is dB', () => {
  const b = p.bendClass('G.657.A2');
  assert.equal(b.minimumDesignRadiusMm, 7.5);
  assert.equal(b.macrobendLossDb.at15mm, 0.03);
  assert.equal(b.macrobendLossDb.at10mm, 0.1);
  // must not treat loss as radius
  assert.ok(b.minimumDesignRadiusMm >= 5);
  assert.ok(b.macrobendLossDb.at15mm < 1);
});

test('unknown splitter loss is not zero', () => {
  const r = p.splitRatioFeasibility({
    code: 'G.984', splitRatio: 32, availableBudgetDb: 28
  });
  assert.equal(r.feasible, false);
  assert.equal(r.reason, 'SPLITTER_LOSS_REQUIRED');
});
