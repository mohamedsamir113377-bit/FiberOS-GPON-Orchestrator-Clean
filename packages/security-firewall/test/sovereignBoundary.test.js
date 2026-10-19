'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSovereignBoundary, expectedSignature } = require('../src/sovereignBoundary');
const { createMicroCache } = require('../../performance-capacity/src/microCache.cjs');

const env = { FIBEROS_KERNEL_HMAC_SECRET: '01234567890123456789012345678901' };
function request(now, extra) {
  const base = { tenantId: 'tenant-a', timestamp: now, nonce: 'nonce-000000000001', method: 'POST', path: '/v1/kernel', bodyHash: 'body-hash' };
  return { method: base.method, path: base.path, headers: { 'x-tenant-id': base.tenantId, 'x-kernel-timestamp': String(base.timestamp), 'x-kernel-nonce': base.nonce, 'x-content-sha256': base.bodyHash, 'x-kernel-signature': expectedSignature(base, env.FIBEROS_KERNEL_HMAC_SECRET), ...(extra || {}) } };
}
test('sovereign boundary accepts a valid request and rejects nonce replay', () => {
  const boundary = createSovereignBoundary({ now: () => 100000 });
  assert.equal(boundary.evaluate(request(100000), env).allow, true);
  assert.equal(boundary.evaluate(request(100000), env).code, 'KERNEL_REPLAY_REJECTED');
});
test('sovereign boundary fails closed on stale timestamp and bad signature', () => {
  const boundary = createSovereignBoundary({ now: () => 100000 });
  assert.equal(boundary.evaluate(request(90000), env).code, 'KERNEL_TIMESTAMP_REJECTED');
  const badBoundary = createSovereignBoundary({ now: () => 100000 });
  const bad = request(100000, { 'x-kernel-signature': '00'.repeat(32) });
  assert.equal(badBoundary.evaluate(bad, env).code, 'KERNEL_SIGNATURE_REJECTED');
  assert.equal(badBoundary.evaluate(request(100000), env).allow, true);
});
test('micro-cache freezes values and invalidates affected keys', () => {
  const cache = createMicroCache({ maxEntries: 2 });
  const value = cache.set('a', { nested: { ok: true } });
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.nested), true);
  assert.equal(cache.invalidateMany(['a', 'missing']), 1);
  assert.equal(cache.size, 0);
});
