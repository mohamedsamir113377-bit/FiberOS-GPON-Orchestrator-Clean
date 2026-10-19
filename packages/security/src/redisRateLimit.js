'use strict';

const crypto = require('node:crypto');
const { readRedisUrl } = require('./redisConnection');

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function parseRedisRole(roleReply) {
  if (!Array.isArray(roleReply) || roleReply.length < 1 || typeof roleReply[0] !== 'string') {
    throw codedError('REDIS_RATE_LIMIT_ROLE_RESPONSE_INVALID');
  }
  const role = roleReply[0].toLowerCase();
  if (role === 'master') {
    const replicas = Array.isArray(roleReply[1]) ? roleReply[1] : [];
    const connectedReplicaCount = replicas.filter((replica) => Array.isArray(replica) && replica.length >= 3).length;
    return Object.freeze({ role: 'master', connectedReplicaCount });
  }
  if (role === 'slave' || role === 'replica') {
    const state = String(roleReply[3] || '').toLowerCase();
    return Object.freeze({ role: 'replica', connectedReplicaCount: state === 'connected' ? 1 : 0 });
  }
  throw codedError('REDIS_RATE_LIMIT_ROLE_RESPONSE_INVALID');
}

const LUA_CONSUME = `
local capacity = tonumber(ARGV[1])
local refill_per_ms = tonumber(ARGV[2])
local ttl_ms = tonumber(ARGV[3])
local now_parts = redis.call('TIME')
local now_ms = tonumber(now_parts[1]) * 1000 + math.floor(tonumber(now_parts[2]) / 1000)
local values = redis.call('HMGET', KEYS[1], 'tokens', 'last_ms')
local tokens = tonumber(values[1]) or capacity
local last_ms = tonumber(values[2]) or now_ms
local elapsed = math.max(0, now_ms - last_ms)
tokens = math.min(capacity, tokens + elapsed * refill_per_ms)
last_ms = now_ms
local allowed = 0
local retry_after = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  retry_after = math.max(1, math.ceil(math.ceil((1 - tokens) / refill_per_ms) / 1000))
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'last_ms', tostring(last_ms))
redis.call('PEXPIRE', KEYS[1], ttl_ms)
return {allowed, math.max(0, math.floor(tokens)), retry_after, capacity}
`;

function createRedisRateLimitStore(env) {
  env = env || process.env;
  const url = readRedisUrl(env);
  const { createClient } = require('redis');
  const rawPrefix = String(env.SECURITY_RATE_LIMIT_REDIS_PREFIX || 'fiberos:rate-limit:v1').trim();
  if (!/^[A-Za-z0-9:_-]{1,96}$/.test(rawPrefix)) throw codedError('REDIS_RATE_LIMIT_PREFIX_INVALID');
  const timeout = Number(env.SECURITY_REDIS_CONNECT_TIMEOUT_MS || 3000);
  const connectTimeout = Number.isInteger(timeout) && timeout >= 500 && timeout <= 10000 ? timeout : 3000;
  const client = createClient({
    url,
    disableOfflineQueue: true,
    socket: {
      connectTimeout,
      reconnectStrategy(retries) {
        if (retries >= 3) return new Error('REDIS_RATE_LIMIT_RECONNECT_LIMIT');
        return Math.min(250 * (retries + 1), 1000);
      }
    }
  });
  // Do not emit connection URLs, usernames, passwords, or provider error text.
  client.on('error', () => {});
  let connectPromise = null;

  async function readyClient() {
    if (client.isReady) return client;
    if (!client.isOpen) {
      if (!connectPromise) {
        connectPromise = client.connect().finally(() => { connectPromise = null; });
      }
      try { await connectPromise; } catch (_) { throw codedError('REDIS_RATE_LIMIT_STORE_UNAVAILABLE'); }
    }
    if (!client.isReady) throw codedError('REDIS_RATE_LIMIT_STORE_UNAVAILABLE');
    return client;
  }

  return Object.freeze({
    async ping() {
      try {
        const active = await readyClient();
        const result = await active.ping();
        if (result !== 'PONG') throw new Error('invalid redis response');
        return true;
      } catch (_) {
        throw codedError('REDIS_RATE_LIMIT_STORE_UNAVAILABLE');
      }
    },
    async inspectHaTopology() {
      try {
        const active = await readyClient();
        return parseRedisRole(await active.sendCommand(['ROLE']));
      } catch (_) {
        throw codedError('REDIS_RATE_LIMIT_TOPOLOGY_UNAVAILABLE');
      }
    },
    async consume(key, policy) {
      policy = policy || {};
      const perMinute = Number(policy.perMinute);
      const burst = Number(policy.burst);
      if (!Number.isInteger(perMinute) || perMinute <= 0 || !Number.isInteger(burst) || burst < 0) {
        throw codedError('REDIS_RATE_LIMIT_POLICY_INVALID');
      }
      const capacity = perMinute + burst;
      const limitClass = String(policy.limitClass || 'normal').replace(/[^A-Za-z0-9_-]/g, '_');
      const digest = crypto.createHash('sha256').update(String(key)).digest('hex');
      const redisKey = `${rawPrefix}:${limitClass}:${digest}`;
      const ttlMs = Math.max(120000, Math.ceil(capacity / (perMinute / 60000)) + 120000);
      try {
        const active = await readyClient();
        const result = await active.eval(LUA_CONSUME, {
          keys: [redisKey],
          arguments: [String(capacity), String(perMinute / 60000), String(ttlMs)]
        });
        if (!Array.isArray(result) || result.length !== 4) throw new Error('invalid redis result');
        const [allowed, remaining, retryAfter, limit] = result.map(Number);
        if (![allowed, remaining, retryAfter, limit].every(Number.isFinite) || (allowed !== 0 && allowed !== 1)) {
          throw new Error('invalid redis result');
        }
        return { allowed: allowed === 1, remaining, retryAfter: retryAfter || null, limit };
      } catch (_) {
        throw codedError('REDIS_RATE_LIMIT_STORE_UNAVAILABLE');
      }
    },
    async close() {
      if (client.isOpen) {
        try { await client.quit(); } catch (_) { client.destroy(); }
      }
    }
  });
}

module.exports = Object.freeze({ createRedisRateLimitStore, readRedisUrl, parseRedisRole, LUA_CONSUME });
