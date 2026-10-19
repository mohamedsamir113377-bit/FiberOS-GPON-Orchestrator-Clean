'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../src/index');

test('the layer registry exposes twelve ordered layers', () => {
  assert.equal(d.TWIN_LAYERS.length, 12);
  assert.equal(d.TWIN_LAYERS[0].key, 'RAW_INGESTION');
  assert.equal(d.TWIN_LAYERS[11].key, 'FEEDBACK');
});

test('validateTwinArchitecture reports missing and unknown layers', () => {
  const incomplete = d.validateTwinArchitecture(['RAW_INGESTION', 'BOGUS']);
  assert.equal(incomplete.complete, false);
  assert.ok(incomplete.missing.includes('FEEDBACK'));
  assert.deepEqual(incomplete.unknown, ['BOGUS']);
  const complete = d.validateTwinArchitecture(d.TWIN_LAYERS.map((l) => l.key));
  assert.equal(complete.complete, true);
});

test('zeroTrustTwinCheck fails closed when a control is missing', () => {
  const r = d.zeroTrustTwinCheck({ authenticated: true, authorized: true, tenantScoped: true, encryptedInTransit: false, leastPrivilege: true });
  assert.equal(r.passed, false);
  assert.deepEqual(r.failures, ['encryptedInTransit']);
});

test('simulationDrift flags breaches beyond tolerance', () => {
  const ok = d.simulationDrift({ observed: [100, 200], simulated: [101, 202], tolerancePct: 5 });
  assert.equal(ok.withinTolerance, true);
  const bad = d.simulationDrift({ observed: [100], simulated: [150], tolerancePct: 5 });
  assert.equal(bad.withinTolerance, false);
  assert.equal(bad.breaches, 1);
});

test('twin truth boundary keeps the twin advisory', () => {
  const b = d.twinTruthBoundary();
  assert.equal(b.twinIsAuthoritative, false);
  assert.equal(b.observedRealityPrevails, true);
});
