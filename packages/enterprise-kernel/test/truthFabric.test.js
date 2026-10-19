'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SOURCES,
  DOMAIN_NEUTRAL_SOURCES,
  sourceAllowedInMode,
  assertSourceAllowedInMode,
  createFact
} = require('../src/truthFabric');

test('domain-neutral source allow-list is explicit', () => {
  assert.ok(SOURCES.includes('otdr_file'));
  assert.ok(!DOMAIN_NEUTRAL_SOURCES.includes('otdr_file'));
  assert.equal(sourceAllowedInMode('manual_entry', 'multi-buyer'), true);
  assert.equal(sourceAllowedInMode('otdr_file', 'multi-buyer'), false);
  assert.equal(sourceAllowedInMode('otdr_file', 'ftth'), true);
});

test('domain-neutral source assertion fails closed for sector-specific sources', () => {
  assert.throws(() => assertSourceAllowedInMode('otdr_file', 'multi-buyer'), {
    code: 'FACT_SOURCE_NOT_ALLOWED_IN_DOMAIN_NEUTRAL_MODE'
  });
  assert.equal(assertSourceAllowedInMode('gis', 'multi-buyer'), true);
});

test('createFact remains backward compatible without a mode', () => {
  const fact = createFact({ subjectType: 'asset', subjectId: 'A1', source: 'otdr_file', observedAt: '2026-09-26T16:00:00Z' });
  assert.equal(fact.source, 'otdr_file');
});

test('createFact enforces domain-neutral source policy when mode is supplied', () => {
  assert.throws(() => createFact({
    subjectType: 'asset', subjectId: 'A2', source: 'otdr_file', mode: 'multi-buyer', observedAt: '2026-09-26T16:00:00Z'
  }), { code: 'FACT_SOURCE_NOT_ALLOWED_IN_DOMAIN_NEUTRAL_MODE' });
});
