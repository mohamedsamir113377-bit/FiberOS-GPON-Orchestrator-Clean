'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { STATUS, IDS, SPECS, listRequirements, createRegistry } = require('../../src/capabilities/external-input-adapter.cjs');

const FOUR = ['ar-scanner', 'business-weather', 'energy-analytics', 'reputation-index'];

test('the adapter contract covers exactly the four capabilities that need external input', () => {
  assert.deepEqual(IDS, FOUR);
  const reqs = listRequirements();
  assert.equal(reqs.length, 4);
  for (const r of reqs) assert.equal(r.externalInputStatus, STATUS.INTEGRATION_REQUIRED);
});

test('every unconfigured capability fails closed with INTEGRATION_REQUIRED and returns no payload', () => {
  for (const cfg of [undefined, {}, { 'energy-analytics': { configured: false } }]) {
    const reg = createRegistry(cfg, {});
    for (const id of FOUR) {
      const r = reg.fetchInput(id);
      assert.equal(r.ok, false);
      assert.equal(r.status, STATUS.INTEGRATION_REQUIRED);
      assert.equal(r.code, 'INTEGRATION_REQUIRED');
      assert.equal(r.payload, undefined);
      assert.ok(r.requirement.length > 20);
    }
  }
});

test('an unknown capability is rejected instead of guessed', () => {
  const r = createRegistry({}, {}).fetchInput('weather-please');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'UNKNOWN_CAPABILITY');
  assert.equal(r.status, STATUS.INVALID_INPUT);
});

test('a configured capability whose transport is not bound is ADAPTER_UNAVAILABLE, never READY', () => {
  const r = createRegistry({ 'energy-analytics': { configured: true, transport: 'csv' } }, {}).fetchInput('energy-analytics');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'TRANSPORT_NOT_BOUND');
  assert.equal(r.status, STATUS.ADAPTER_UNAVAILABLE);
});

test('an unsupported transport is refused', () => {
  const r = createRegistry({ 'energy-analytics': { configured: true, transport: 'carrier-pigeon' } }, {}).fetchInput('energy-analytics');
  assert.equal(r.code, 'UNSUPPORTED_TRANSPORT');
});

test('a throwing transport surfaces as TRANSPORT_FAILED without inventing a value', () => {
  const reg = createRegistry({ 'energy-analytics': { configured: true, transport: 'csv' } }, { csv: () => { throw new Error('socket closed'); } });
  const r = reg.fetchInput('energy-analytics');
  assert.equal(r.code, 'TRANSPORT_FAILED');
  assert.equal(r.reason, 'socket closed');
});

test('a transport returning null is NO_DATA, still INTEGRATION_REQUIRED', () => {
  const reg = createRegistry({ 'energy-analytics': { configured: true, transport: 'csv' } }, { csv: () => null });
  const r = reg.fetchInput('energy-analytics');
  assert.equal(r.code, 'NO_DATA');
  assert.equal(r.status, STATUS.INTEGRATION_REQUIRED);
});

test('a missing required field is reported by name', () => {
  const reg = createRegistry({ 'energy-analytics': { configured: true, transport: 'csv' } }, { csv: () => ({}) });
  const r = reg.fetchInput('energy-analytics');
  assert.equal(r.code, 'MISSING_FIELD');
  assert.equal(r.field, 'readings');
});

test('malformed rows are rejected with INVALID_PAYLOAD', () => {
  const reg = createRegistry({ 'energy-analytics': { configured: true, transport: 'csv' } }, { csv: () => ({ readings: [{ ts: 'not-a-date', kwh: 'x' }] }) });
  const r = reg.fetchInput('energy-analytics');
  assert.equal(r.code, 'INVALID_PAYLOAD');
  assert.equal(r.status, STATUS.INVALID_INPUT);
});

test('a complete, well-formed payload is accepted and marked READY', () => {
  const reg = createRegistry(
    { 'energy-analytics': { configured: true, transport: 'csv', source: 'buyer-meter-export' } },
    { csv: () => ({ readings: [{ ts: '2026-10-01T00:00:00Z', kwh: 1000 }, { ts: '2026-10-02T00:00:00Z', kwh: 1012.5 }] }) },
  );
  const r = reg.fetchInput('energy-analytics');
  assert.equal(r.ok, true);
  assert.equal(r.status, STATUS.READY);
  assert.equal(r.source, 'buyer-meter-export');
  assert.equal(r.payload.readings.length, 2);
});

test('the reputation-index adapter rejects an indicator set with no authoritative source', () => {
  const reg = createRegistry(
    { 'reputation-index': { configured: true, transport: 'http-json' } },
    { 'http-json': () => ({ definition: { indicators: [{ id: 'nps', weight: 1, min: 0, max: 10 }] }, observations: { nps: 7 } }) },
  );
  const r = reg.fetchInput('reputation-index');
  assert.equal(r.code, 'INVALID_PAYLOAD');
  assert.match(r.reason, /source is required/);
});

test('the ar-scanner adapter refuses a capture payload without a signed photo hash', () => {
  const reg = createRegistry(
    { 'ar-scanner': { configured: true, transport: 'http-json' } },
    { 'http-json': () => ({ captures: [{ assetId: 'ONT-001', lat: 30.1, lng: 31.2, accuracyM: 5, photoSha256: 'NOPE', capturedAt: '2026-10-15T10:00:00Z' }] }) },
  );
  const r = reg.fetchInput('ar-scanner');
  assert.equal(r.code, 'INVALID_PAYLOAD');
  assert.match(r.reason, /photoSha256/);
});

test('the checked-in adapter configuration is fail-closed and keeps every capability at INTEGRATION_REQUIRED', () => {
  const p = path.join(__dirname, '../../../../config/capability-input-adapters.v1.json');
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(cfg.schema, 'fiberos.capability-input-adapters.v1');
  assert.equal(cfg.policy.failClosed, true);
  assert.equal(cfg.policy.allowDefaults, false);
  assert.equal(cfg.policy.allowEstimates, false);
  assert.deepEqual(Object.keys(cfg.adapters).sort(), FOUR);
  for (const id of FOUR) {
    assert.equal(cfg.adapters[id].configured, false, id + ' must not ship configured');
    assert.equal(cfg.adapters[id].externalInputStatus, 'INTEGRATION_REQUIRED', id);
    assert.ok(SPECS[id], id + ' must exist in the adapter contract');
    assert.deepEqual(cfg.adapters[id].requiredInputs, SPECS[id].requires, id);
    assert.deepEqual(cfg.adapters[id].acceptedTransports, SPECS[id].transports, id);
  }
});
