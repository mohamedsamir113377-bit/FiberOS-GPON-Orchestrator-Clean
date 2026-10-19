'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const gate = require('../src/domain-neutrality-gate');

test('multi-buyer mode catches FTTH-specific claims', () => {
  const result = gate.check('Universal platform with FTTH and OTDR support', { mode: 'multi-buyer' });
  assert.equal(result.ok, false);
  assert.ok(result.hits.some(hit => hit.term === 'ftth'));
  assert.ok(result.hits.some(hit => hit.term === 'otdr'));
});

test('sector mode permits sector-specific claims', () => {
  const result = gate.check('FTTH and OTDR engineering profile', { mode: 'ftth' });
  assert.equal(result.ok, true);
});
