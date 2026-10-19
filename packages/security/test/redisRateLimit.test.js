'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRateLimiter, validateSecurityConfiguration } = require('../src/httpHardening');
const { createRedisRateLimitStore, readRedisUrl, parseRedisRole } = require('../src/redisRateLimit');

let redisPackageAvailable = true;
try { require.resolve('redis'); } catch (_) { redisPackageAvailable = false; }

const rateEnv = (extra = {}) => ({
  SECURITY_RATE_LIMIT_PER_MINUTE: '1',
  SECURITY_RATE_LIMIT_BURST: '0',
  SECURITY_RATE_LIMIT_BACKEND: 'REDIS',
  REDIS_URL: 'redis://127.0.0.1:6379',
  ...extra
});

test('Redis backend is selectable and advertises a genuinely shared scope', { skip: !redisPackageAvailable && 'redis workspace dependency is not installed in this test environment' }, async () => {
  const limiter = createRateLimiter(rateEnv());
  assert.equal(limiter.scope, 'SHARED_REDIS');
  assert.equal(limiter.configured, true);
  await limiter.close();
});

test('Redis URL is validated and may be supplied through a mounted secret file', () => {
  assert.throws(() => createRedisRateLimitStore(rateEnv({ REDIS_URL: 'https://example.invalid' })), /REDIS_RATE_LIMIT_URL_INVALID/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fiberos-redis-secret-'));
  const file = path.join(dir, 'redis-url');
  try {
    fs.writeFileSync(file, 'rediss://rate-user:secret@redis.example:6380\n', { mode: 0o600 });
    assert.equal(readRedisUrl({ REDIS_URL_FILE: file }), 'rediss://rate-user:secret@redis.example:6380');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Redis ROLE topology parser counts connected replicas and rejects unusable topology responses', () => {
  assert.deepEqual(parseRedisRole(['master', [['10.0.0.2', '6379', '100'], ['10.0.0.3', '6379', '100']], '100']), {
    role: 'master', connectedReplicaCount: 2
  });
  assert.deepEqual(parseRedisRole(['master', [], '100']), { role: 'master', connectedReplicaCount: 0 });
  assert.deepEqual(parseRedisRole(['slave', '10.0.0.1', '6379', 'connected', '100']), {
    role: 'replica', connectedReplicaCount: 1
  });
  assert.deepEqual(parseRedisRole(['slave', '10.0.0.1', '6379', 'sync', '0']), {
    role: 'replica', connectedReplicaCount: 0
  });
  assert.throws(() => parseRedisRole(['sentinel']), /REDIS_RATE_LIMIT_ROLE_RESPONSE_INVALID/);
});

test('production requires an explicit sovereign-boundary choice and strong secret if enabled', () => {
  const base = {
    NODE_ENV: 'production',
    SECURITY_RATE_LIMIT_PER_MINUTE: '60',
    SECURITY_RATE_LIMIT_BURST: '10',
    SECURITY_RATE_LIMIT_BACKEND: 'PROCESS_LOCAL',
    SECURITY_RATE_LIMIT_EXPECTED_INSTANCES: '1',
    CORS_ORIGIN: 'https://field.example'
  };
  assert.ok(validateSecurityConfiguration(base).failures.includes('KERNEL_BOUNDARY_MODE_MUST_BE_EXPLICIT_IN_PRODUCTION'));
  assert.ok(validateSecurityConfiguration({ ...base, FIBEROS_KERNEL_BOUNDARY_REQUIRED: 'false' }).failures.includes('REPLAY_DEFENSE_REDIS_REQUIRED'));
  assert.equal(validateSecurityConfiguration({ ...base, FIBEROS_KERNEL_BOUNDARY_REQUIRED: 'false', FIBEROS_REPLAY_DEFENSE_REQUIRED: 'false' }).ok, true);
  assert.ok(validateSecurityConfiguration({ ...base, FIBEROS_KERNEL_BOUNDARY_REQUIRED: 'true' }).failures.includes('KERNEL_BOUNDARY_HMAC_SECRET_TOO_WEAK'));
  assert.equal(validateSecurityConfiguration({ ...base, FIBEROS_KERNEL_BOUNDARY_REQUIRED: 'true', FIBEROS_KERNEL_HMAC_SECRET: 'x'.repeat(32), FIBEROS_REPLAY_DEFENSE_REQUIRED: 'false' }).ok, true);
  assert.ok(validateSecurityConfiguration({ ...base, FIBEROS_KERNEL_BOUNDARY_REQUIRED: 'true', FIBEROS_KERNEL_HMAC_SECRET: 'x'.repeat(32), SECURITY_RATE_LIMIT_EXPECTED_INSTANCES: '2' }).failures.includes('KERNEL_BOUNDARY_REPLAY_STORE_PROCESS_LOCAL_FOR_MULTI_INSTANCE'));
});

test('independent limiter instances share the same Redis token bucket', { skip: !process.env.FIBEROS_REDIS_TEST_URL }, async () => {
  const prefix = 'fiberos:test:' + crypto.randomUUID();
  const env = rateEnv({ REDIS_URL: process.env.FIBEROS_REDIS_TEST_URL, SECURITY_RATE_LIMIT_REDIS_PREFIX: prefix });
  const first = createRateLimiter(env);
  const second = createRateLimiter(env);
  const key = crypto.randomUUID();
  try {
    const admitted = await first.allow(key, { limitClass: 'strict' });
    const denied = await second.allow(key, { limitClass: 'strict' });
    assert.equal(admitted.allowed, true);
    assert.equal(denied.allowed, false);
    assert.equal(denied.retryAfter >= 1, true);
    const topologyStore = createRedisRateLimitStore(env);
    try {
      const topology = await topologyStore.inspectHaTopology();
      assert.equal(topology.role, 'master');
      assert.equal(Number.isInteger(topology.connectedReplicaCount), true);
    } finally {
      await topologyStore.close();
    }
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});
