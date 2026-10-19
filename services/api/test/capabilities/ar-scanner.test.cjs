'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCapture, registerCapture, certifyCapture } = require('../../src/capabilities/ar-scanner.cjs');

const good = {
  assetId: 'OLT-CAI-01', lat: 30.0444, lng: 31.2357, accuracyM: 6.5,
  photoSha256: 'a'.repeat(64), capturedAt: '2026-10-15T09:00:00.000Z',
};
const NOW = Date.parse('2026-10-15T09:01:00.000Z');

test('accepts a well-formed field capture', () => {
  assert.deepEqual(validateCapture(good, NOW), { valid: true, errors: [] });
});
test('rejects bad coordinates, missing photo hash and future timestamps', () => {
  assert.equal(validateCapture({ ...good, lat: 200 }, NOW).valid, false);
  assert.equal(validateCapture({ ...good, photoSha256: 'nope' }, NOW).valid, false);
  const future = validateCapture({ ...good, capturedAt: '2026-10-15T23:00:00.000Z' }, NOW);
  assert.equal(future.valid, false);
  assert.ok(future.errors.some((e) => /future/.test(e)));
});
test('registration is idempotent on assetId + photo hash', () => {
  const store = { captures: [] };
  const actor = { id: 'u1', role: 'technician' };
  const first = registerCapture(store, actor, good, NOW);
  const second = registerCapture(store, actor, good, NOW);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.duplicate, true);
  assert.equal(store.captures.length, 1);
});
test('a viewer cannot capture and a technician cannot certify', () => {
  const store = { captures: [] };
  assert.equal(registerCapture(store, { id: 'v', role: 'viewer' }, good, NOW).code, 'FORBIDDEN');
  const r = registerCapture(store, { id: 't', role: 'technician' }, good, NOW);
  assert.equal(certifyCapture(store, { id: 't', role: 'technician' }, r.id).code, 'FORBIDDEN');
  assert.equal(certifyCapture(store, { id: 's', role: 'supervisor' }, r.id).ok, true);
});
