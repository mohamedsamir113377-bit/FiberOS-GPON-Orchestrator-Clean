'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, computeIndex, fileObjection, validateIndicators } = require('../../src/capabilities/reputation-index.cjs');

const def = { version: '1.2.0', indicators: [
  { id: 'ticket-sla', weight: 3, min: 0, max: 100, source: 'ops.tickets' },
  { id: 'repeat-faults', weight: 1, min: 0, max: 20, source: 'ops.faults', invert: true },
]};

test('normalizes and inverts where required', () => {
  assert.equal(normalize(50, { min: 0, max: 100 }), 0.5);
  assert.equal(normalize(0, { min: 0, max: 20, invert: true }), 1);
  assert.equal(normalize(-5, { min: 0, max: 100 }), 0);
});
test('computes a weighted index only when every indicator has a real observation', () => {
  const missing = computeIndex(def, { 'ticket-sla': 90 });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing, ['repeat-faults']);
  const ok = computeIndex(def, { 'ticket-sla': 90, 'repeat-faults': 4 });
  assert.equal(ok.ok, true);
  assert.equal(ok.parts.length, 2);
  assert.ok(ok.score > 0 && ok.score <= 100);
});
test('a definition without sources is rejected, so nothing is estimated', () => {
  const v = validateIndicators([{ id: 'x', weight: 1, min: 0, max: 1 }]);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /source is required/.test(e)));
});
test('objections require a substantive reason', () => {
  const store = { objections: [] };
  assert.equal(fileObjection(store, { indexId: 'i1', reason: 'wrong', by: 'u1' }).code, 'INVALID');
  const ok = fileObjection(store, { indexId: 'i1', reason: 'The fault source omits scheduled maintenance windows.', by: 'u1' });
  assert.equal(ok.ok, true);
  assert.equal(store.objections.length, 1);
});
