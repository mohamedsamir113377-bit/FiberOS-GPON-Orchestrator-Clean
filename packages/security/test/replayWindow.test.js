'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReplayTimestamp, parseReplayTimestamp, requestFingerprint, bindReplayContext, DEFAULT_WINDOW_SECONDS } = require('../src/replayWindow');
const { createRedisReplayDefense, validateReplayTimestamp: reExported } = require('../src/redisReplayDefense');

function code(fn) { try { fn(); return null; } catch (e) { return e.code; } }
function fakeRedis() {
  const map = new Map();
  return {
    async set(k, v, o) { if (o && o.NX && map.has(k)) return null; map.set(k, v); return 'OK'; },
    async del(k) { return map.delete(k) ? 1 : 0; }
  };
}

test('P1.3-01 a fresh timestamp inside the window is accepted', () => {
  const now = Date.now();
  const v = validateReplayTimestamp(now - 1000, { now, windowSeconds: 300 });
  assert.ok(v.ageMs >= 0);
  assert.equal(v.expiresAt, now - 1000 + 300000);
});
test('P1.3-02 a stale timestamp is rejected as expired', () => {
  const now = Date.now();
  assert.equal(code(() => validateReplayTimestamp(now - 301000, { now, windowSeconds: 300 })), 'REPLAY_TIMESTAMP_EXPIRED');
});
test('P1.3-03 a future-dated timestamp beyond skew is rejected', () => {
  const now = Date.now();
  assert.equal(code(() => validateReplayTimestamp(now + 600000, { now, windowSeconds: 300, futureSkewSeconds: 60 })), 'REPLAY_TIMESTAMP_IN_FUTURE');
});
test('P1.3-04 malformed and missing timestamps are rejected', () => {
  assert.equal(code(() => validateReplayTimestamp(undefined, { now: Date.now() })), 'REPLAY_TIMESTAMP_REQUIRED');
  assert.equal(code(() => validateReplayTimestamp('   ', { now: Date.now() })), 'REPLAY_TIMESTAMP_REQUIRED');
  assert.equal(code(() => validateReplayTimestamp('not-a-date', { now: Date.now() })), 'REPLAY_TIMESTAMP_INVALID');
  assert.equal(code(() => validateReplayTimestamp(NaN, { now: Date.now() })), 'REPLAY_TIMESTAMP_INVALID');
  assert.equal(code(() => parseReplayTimestamp('tomorrow')), 'REPLAY_TIMESTAMP_INVALID');
});
test('P1.3-05 seconds and milliseconds epochs are interpreted explicitly', () => {
  const now = Date.now();
  assert.equal(validateReplayTimestamp(Math.floor(now / 1000), { now }).at, Math.floor(now / 1000) * 1000);
  assert.equal(validateReplayTimestamp(now, { now }).at, now);
  assert.equal(validateReplayTimestamp(new Date(now).toISOString(), { now }).windowSeconds, DEFAULT_WINDOW_SECONDS);
});
test('P1.3-06 an invalid window is rejected rather than silently defaulted', () => {
  assert.equal(code(() => validateReplayTimestamp(Date.now(), { now: Date.now(), windowSeconds: 0 })), 'REPLAY_TIMESTAMP_WINDOW_INVALID');
  assert.equal(code(() => validateReplayTimestamp(Date.now(), { now: Date.now(), windowSeconds: 999999 })), 'REPLAY_TIMESTAMP_WINDOW_INVALID');
});
test('P1.3-07 the fingerprint binds the reservation to request content', () => {
  const a = requestFingerprint({ amount: 10 });
  assert.equal(a.length, 64);
  assert.equal(requestFingerprint({ amount: 10 }), a);
  assert.notEqual(requestFingerprint({ amount: 11 }), a);
  assert.notEqual(requestFingerprint('{"amount":10}'), requestFingerprint({ amount: 10 }));
  assert.equal(requestFingerprint(null), requestFingerprint(undefined));
});
test('P1.3-08 a modified request cannot reuse the same idempotency key+content slot', async () => {
  const d = createRedisReplayDefense(fakeRedis());
  const nonce = 'n'.repeat(32);
  const original = bindReplayContext({ userId: 'u1', tenantId: 't1', operationType: 'POST:/v1/evidence/submit', bodyFingerprint: requestFingerprint({ a: 1 }) });
  const modified = bindReplayContext({ userId: 'u1', tenantId: 't1', operationType: 'POST:/v1/evidence/submit', bodyFingerprint: requestFingerprint({ a: 2 }) });
  assert.equal((await d.reserve(nonce, original)).replay, false);
  assert.equal((await d.reserve(nonce, modified)).replay, false, 'different content must not be blocked by the original reservation');
  assert.equal((await d.reserve(nonce, original)).replay, true, 'the original content must never be accepted twice');
});
test('P1.3-09 the reservation is bound to subject, tenant and operation', async () => {
  const d = createRedisReplayDefense(fakeRedis());
  const nonce = 'b'.repeat(32);
  await d.reserve(nonce, bindReplayContext({ userId: 'u1', tenantId: 't1', operationType: 'POST:/v1/x' }));
  assert.equal((await d.reserve(nonce, bindReplayContext({ userId: 'u2', tenantId: 't1', operationType: 'POST:/v1/x' }))).replay, false);
  assert.equal((await d.reserve(nonce, bindReplayContext({ userId: 'u1', tenantId: 't2', operationType: 'POST:/v1/x' }))).replay, false);
  assert.equal((await d.reserve(nonce, bindReplayContext({ userId: 'u1', tenantId: 't1', operationType: 'POST:/v1/y' }))).replay, false);
});
test('P1.3-10 an unbound context is rejected instead of defaulting to a shared slot', () => {
  assert.equal(code(() => bindReplayContext({ userId: '', operationType: 'POST:/v1/x' })), 'REPLAY_SUBJECT_REQUIRED');
  assert.equal(code(() => bindReplayContext({ userId: 'u1', operationType: '' })), 'REPLAY_OPERATION_REQUIRED');
  assert.equal(bindReplayContext({ userId: 'u1', operationType: 'POST:/v1/x' }).tenant, 'UNBOUND');
});
test('P1.3-11 reserve() enforces the timestamp window when supplied', async () => {
  const d = createRedisReplayDefense(fakeRedis());
  const now = Date.now();
  await assert.rejects(() => d.reserve('t'.repeat(32), 'ctx', { timestamp: now - 400000, now, windowSeconds: 300 }), /REPLAY_TIMESTAMP_EXPIRED/);
  const ok = await d.reserve('t'.repeat(32), 'ctx', { timestamp: now - 1000, now, windowSeconds: 300 });
  assert.deepEqual(ok, { replay: false, seen: false });
});
test('P1.3-12 concurrent duplicates still yield exactly one accepted request under the window', async () => {
  const d = createRedisReplayDefense(fakeRedis());
  const nonce = 'c'.repeat(32);
  const now = Date.now();
  const out = await Promise.all(Array.from({ length: 12 }, () => d.reserve(nonce, 'ctx', { timestamp: now, now, windowSeconds: 300 })));
  assert.equal(out.filter((x) => !x.replay).length, 1);
  assert.equal(out.filter((x) => x.replay).length, 11);
});
test('P1.3-13 the helpers are exposed from the replay-defense module', () => {
  assert.equal(reExported, validateReplayTimestamp);
  assert.equal(typeof requestFingerprint, 'function');
});
