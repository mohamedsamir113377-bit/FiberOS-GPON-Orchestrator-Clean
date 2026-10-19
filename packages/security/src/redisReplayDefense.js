'use strict';

const crypto = require('node:crypto');
const { readRedisUrl } = require('./redisConnection');
const { validateReplayTimestamp, requestFingerprint, bindReplayContext, parseReplayTimestamp } = require('./replayWindow');

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function canonicalContext(context) {
  if (context == null) return '';
  if (typeof context === 'string') return context;
  if (typeof context !== 'object' || Array.isArray(context)) throw codedError('REPLAY_CONTEXT_INVALID');
  const keys = Object.keys(context).sort();
  return keys.map((key) => `${key}=${JSON.stringify(context[key])}`).join('&');
}

function validateNonce(nonce) {
  const value = String(nonce == null ? '' : nonce).trim();
  if (!/^[A-Za-z0-9._~-]{16,256}$/.test(value)) throw codedError('REPLAY_NONCE_INVALID');
  return value;
}

function createRedisReplayDefense(redisClient, options = {}) {
  if (!redisClient || typeof redisClient.set !== 'function' || typeof redisClient.del !== 'function') {
    throw codedError('REPLAY_REDIS_CLIENT_REQUIRED');
  }
  const rawPrefix = String(options.prefix || 'fiberos:replay:v1').trim();
  const ttlSeconds = Number(options.ttlSeconds || 300);
  if (!/^[A-Za-z0-9:_-]{1,96}$/.test(rawPrefix)) throw codedError('REPLAY_PREFIX_INVALID');
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 86400) throw codedError('REPLAY_TTL_INVALID');

  function keyFor(nonce, context) {
    const safeNonce = validateNonce(nonce);
    const normalizedContext = canonicalContext(context);
    const digest = crypto.createHash('sha256').update(normalizedContext).update('\0').update(safeNonce).digest('hex');
    return `${rawPrefix}:${digest}`;
  }

  return Object.freeze({
    generateNonce() {
      return crypto.randomBytes(32).toString('base64url');
    },
    async reserve(nonce, context = '', options = {}) {
      // Optional timestamp enforcement keeps the existing two-argument contract
      // intact while letting callers bind the reservation to a validity window.
      if (options && options.timestamp != null) {
        validateReplayTimestamp(options.timestamp, { now: options.now, windowSeconds: options.windowSeconds || ttlSeconds, futureSkewSeconds: options.futureSkewSeconds });
      }
      const key = keyFor(nonce, context);
      try {
        const inserted = await redisClient.set(key, JSON.stringify({ reservedAt: Date.now(), context: canonicalContext(context) }), { NX: true, EX: ttlSeconds });
        if (inserted === null) return { replay: true, seen: true };
        if (inserted !== 'OK') throw new Error('invalid redis response');
        return { replay: false, seen: false };
      } catch (error) {
        if (error && error.code === 'REPLAY_NONCE_INVALID') throw error;
        throw codedError('REPLAY_DEFENSE_REDIS_FAILED');
      }
    },
    async checkAndMarkNonce(nonce, context = '') {
      return this.reserve(nonce, context);
    },
    async revoke(nonce, context = '') {
      const key = keyFor(nonce, context);
      try {
        await redisClient.del(key);
        return true;
      } catch (_) {
        throw codedError('REPLAY_DEFENSE_REDIS_FAILED');
      }
    },
    keyFor
  });
}

function createRedisReplayDefenseFromEnv(env = process.env, options = {}) {
  const { createClient } = require('redis');
  const url = readRedisUrl(env);
  const client = createClient({
    url,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: Math.min(10000, Math.max(500, Number(env.SECURITY_REDIS_CONNECT_TIMEOUT_MS || 3000))),
      reconnectStrategy(retries) {
        if (retries >= 3) return new Error('REPLAY_REDIS_RECONNECT_LIMIT');
        return Math.min(250 * (retries + 1), 1000);
      }
    }
  });
  client.on('error', () => {});
  let connectPromise = null;
  async function ready() {
    if (client.isReady) return client;
    if (!client.isOpen) {
      if (!connectPromise) connectPromise = client.connect().finally(() => { connectPromise = null; });
      try { await connectPromise; } catch (_) { throw codedError('REPLAY_DEFENSE_REDIS_FAILED'); }
    }
    if (!client.isReady) throw codedError('REPLAY_DEFENSE_REDIS_FAILED');
    return client;
  }
  const defense = createRedisReplayDefense({
    async set(...args) { return (await ready()).set(...args); },
    async del(...args) { return (await ready()).del(...args); }
  }, options);
  return Object.freeze({
    ...defense,
    async ping() {
      try { const active = await ready(); if (await active.ping() !== 'PONG') throw new Error('invalid redis'); return true; }
      catch (_) { throw codedError('REPLAY_DEFENSE_REDIS_FAILED'); }
    },
    async close() { if (client.isOpen) { try { await client.quit(); } catch (_) { client.destroy(); } } }
  });
}

module.exports = Object.freeze({ createRedisReplayDefense, createRedisReplayDefenseFromEnv, canonicalContext, validateNonce, validateReplayTimestamp, parseReplayTimestamp, requestFingerprint, bindReplayContext });
