'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { defineInputs, compute } = require('../../src/capabilities/business-weather.cjs');

const defs = [
  { id: 'ticket-backlog', source: 'ops.tickets', unit: 'count', min: 0, max: 500, weight: 2, invert: true },
  { id: 'revenue-run-rate', source: 'finance.ledger', unit: 'EGP', min: 0, max: 1000000, weight: 3, invert: false },
];

test('an input without a source or a scale makes the feature undefined', () => {
  const r = defineInputs([{ id: 'x', unit: 'count', min: 0, max: 1, weight: 1, invert: false }]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /source is required/.test(e)));
});
test('missing inputs withhold the index instead of guessing', () => {
  const r = compute(defs, { 'ticket-backlog': 100 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'MISSING_INPUTS');
  assert.deepEqual(r.missing, ['revenue-run-rate']);
});
test('computes a bounded 0..100 index with a band and named sources', () => {
  const r = compute(defs, { 'ticket-backlog': 0, 'revenue-run-rate': 1000000 });
  assert.equal(r.ok, true);
  assert.ok(r.index >= 0 && r.index <= 100);
  assert.equal(r.band, 'clear');
  assert.deepEqual(r.computedFrom, ['ops.tickets', 'finance.ledger']);
  const low = compute(defs, { 'ticket-backlog': 500, 'revenue-run-rate': 0 });
  assert.equal(low.band, 'severe');
});
