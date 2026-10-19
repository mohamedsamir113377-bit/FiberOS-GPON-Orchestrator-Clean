'use strict';

const crypto = require('node:crypto');
const { readRedisUrl } = require('./redisConnection');

function codedError(code) { const error = new Error(code); error.code = code; return error; }

function createRedisSessionStore(env = process.env, options = {}) {
  const { createClient } = require('redis');
  const url = readRedisUrl(env);
  const prefix = String(options.prefix || 'fiberos:session:v1').trim();
  if (!/^[A-Za-z0-9:_-]{1,96}$/.test(prefix)) throw codedError('SESSION_PREFIX_INVALID');
  const client = createClient({
    url,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: Math.min(10000, Math.max(500, Number(env.SECURITY_REDIS_CONNECT_TIMEOUT_MS || 3000))),
      reconnectStrategy(retries) {
        if (retries >= 3) return new Error('SESSION_REDIS_RECONNECT_LIMIT');
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
      try { await connectPromise; } catch (_) { throw codedError('SESSION_STORE_UNAVAILABLE'); }
    }
    if (!client.isReady) throw codedError('SESSION_STORE_UNAVAILABLE');
    return client;
  }
  const key = (type, id) => `${prefix}:${type}:${id}`;
  return Object.freeze({
    async ping() { try { if (await (await ready()).ping() !== 'PONG') throw new Error(); return true; } catch (_) { throw codedError('SESSION_STORE_UNAVAILABLE'); } },
    async setSession(id, value, ttlSeconds) { if (!/^[A-Za-z0-9_-]{32,128}$/.test(id)) throw codedError('SESSION_ID_INVALID'); if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86400) throw codedError('SESSION_TTL_INVALID'); try { await (await ready()).set(key('sid', id), JSON.stringify(value), { EX: ttlSeconds }); return true; } catch (_) { throw codedError('SESSION_STORE_UNAVAILABLE'); } },
    async getSession(id) { if (!/^[A-Za-z0-9_-]{32,128}$/.test(id)) return null; try { const raw = await (await ready()).get(key('sid', id)); if (!raw) return null; return JSON.parse(raw); } catch (_) { throw codedError('SESSION_STORE_UNAVAILABLE'); } },
    async deleteSession(id) { if (!/^[A-Za-z0-9_-]{32,128}$/.test(id)) return false; try { await (await ready()).del(key('sid', id)); return true; } catch (_) { throw codedError('SESSION_STORE_UNAVAILABLE'); } },
    async createTransaction(state, value, ttlSeconds) { if (!/^[A-Za-z0-9_-]{32,128}$/.test(state)) throw codedError('OIDC_STATE_INVALID'); if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 900) throw codedError('OIDC_STATE_TTL_INVALID'); try { const added = await (await ready()).set(key('tx', state), JSON.stringify(value), { NX: true, EX: ttlSeconds }); if (added !== 'OK') throw codedError('OIDC_STATE_COLLISION'); return true; } catch (error) { if (error && error.code === 'OIDC_STATE_COLLISION') throw error; throw codedError('SESSION_STORE_UNAVAILABLE'); } },
    async consumeTransaction(state) { if (!/^[A-Za-z0-9_-]{32,128}$/.test(state)) return null; try { const active = await ready(); if (typeof active.getDel === 'function') { const raw = await active.getDel(key('tx', state)); return raw ? JSON.parse(raw) : null; } const raw = await active.get(key('tx', state)); await active.del(key('tx', state)); return raw ? JSON.parse(raw) : null; } catch (_) { throw codedError('SESSION_STORE_UNAVAILABLE'); } },
    newId() { return crypto.randomBytes(32).toString('base64url'); },
    newCsrfToken() { return crypto.randomBytes(32).toString('base64url'); },
    async close() { if (client.isOpen) { try { await client.quit(); } catch (_) { client.destroy(); } } }
  });
}

module.exports = Object.freeze({ createRedisSessionStore });
