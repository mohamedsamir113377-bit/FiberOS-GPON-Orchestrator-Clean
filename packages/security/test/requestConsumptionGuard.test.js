'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertRequestConsumption } = require('../src/requestConsumptionGuard');

test('rejects oversized arrays', () => {
  assert.throws(
    () => assertRequestConsumption({ items: new Array(201).fill(1) }),
    /REQUEST_ARRAY_TOO_LONG/
  );
});

test('accepts modest payload', () => {
  const r = assertRequestConsumption({ a: 'ok', list: [1, 2, 3] });
  assert.equal(r.ok, true);
});
