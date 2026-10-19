'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, append, update, remove, asOf, verifyChain } = require('../../src/capabilities/enterprise-tm.cjs');

const T0 = Date.parse('2026-10-15T08:00:00Z');
function seeded() {
  const s = createStore();
  append(s, { tenantId: 'A', table: 'assets', pk: '1', op: 'INSERT', newData: { name: 'v1' }, actor: 'u1' }, T0);
  append(s, { tenantId: 'A', table: 'assets', pk: '1', op: 'UPDATE', oldData: { name: 'v1' }, newData: { name: 'v2' }, actor: 'u1' }, T0 + 60000);
  append(s, { tenantId: 'B', table: 'assets', pk: '9', op: 'INSERT', newData: { name: 'other' }, actor: 'u2' }, T0 + 90000);
  return s;
}
test('reconstructs the row state at a point in time', () => {
  const s = seeded();
  assert.deepEqual(asOf(s, 'A', 'assets', '1', T0 + 30000).value, { name: 'v1' });
  assert.deepEqual(asOf(s, 'A', 'assets', '1', T0 + 120000).value, { name: 'v2' });
});
test('a deleted row is reported as absent, not as the pre-delete value', () => {
  const s = seeded();
  append(s, { tenantId: 'A', table: 'assets', pk: '1', op: 'DELETE', oldData: { name: 'v2' }, actor: 'u1' }, T0 + 180000);
  const r = asOf(s, 'A', 'assets', '1', T0 + 200000);
  assert.equal(r.found, false);
  assert.equal(r.value, null);
});
test('tenant isolation: tenant A never reads tenant B history', () => {
  const s = seeded();
  assert.equal(asOf(s, 'A', 'assets', '9', T0 + 999999).found, false);
  assert.equal(s.entries.filter((e) => e.tenantId === 'B').length, 1);
});
test('the log refuses updates and deletes', () => {
  assert.equal(update().code, 'APPEND_ONLY');
  assert.equal(remove().code, 'APPEND_ONLY');
});
test('the hash chain verifies, and detects out-of-band tampering', () => {
  const s = seeded();
  assert.equal(verifyChain(s, 'A'), null);
  s.entries[1].newData = { name: 'HACK' };
  assert.equal(verifyChain(s, 'A'), 2);
});
test('an UPDATE without oldData is rejected', () => {
  const s = createStore();
  assert.equal(append(s, { tenantId: 'A', table: 't', pk: '1', op: 'UPDATE', newData: {}, actor: 'u' }).code, 'INVALID');
});
