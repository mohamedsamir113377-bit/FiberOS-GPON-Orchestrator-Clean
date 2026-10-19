/**
 * @fiberos/db — Postgres access boundary.
 * Runtime is fail-closed: missing configuration/driver or a dead database
 * cannot be converted into a simulated database success.
 */
'use strict';

const { error: logError } = require('../../observability/src/logger');
const { resolveDatabaseUrl, readSecretEnvValue } = require('./databaseUrl');

function loadPg() {
  var paths = ['pg'];
  try {
    if (process.env.FIBEROS_PG_PATH) paths.unshift(process.env.FIBEROS_PG_PATH);
  } catch (e) {
    // Reading an env var cannot realistically throw; kept defensive only.
    // Not logged deliberately — this is not the swallowed failure path
    // (see the M-7 fix below for the one that actually mattered).
  }
  paths.push('/tmp/pgisol/node_modules/pg');
  var last;
  for (var i = 0; i < paths.length; i++) {
    try {
      return require(paths[i]);
    } catch (e) {
      last = e;
    }
  }
  // M-7 fix (2026-09-17): `last` (the real reason every candidate path for
  // the `pg` driver failed to load) was captured and then discarded. Every
  // downstream DB-required call then just saw "database unavailable" with
  // no way to tell "pg isn't installed" apart from "wrong path" apart from
  // a syntax/version error in the driver itself. Log it once here so the
  // actual cause is visible in server logs instead of only being
  // reconstructable by re-running loadPg() manually.
  if (last) {
    logError('pg_driver_load_failed', {
      triedPaths: paths,
      error: String(last && last.message || last)
    });
  }
  return null;
}

var pg = loadPg();
var Pool = pg && pg.Pool ? pg.Pool : null;

function failClosedError(code) {
  var e = new Error(code);
  e.code = code;
  e.statusCode = 503;
  return e;
}

function createPool(env) {
  env = env || process.env;
  var resolution;
  try { resolution = resolveDatabaseUrl(env, 'DATABASE_URL'); }
  catch (error) {
    return {
      configured: false,
      reason: error.code || 'DATABASE_URL_RESOLUTION_FAILED',
      query: async function () { throw failClosedError(error.code || 'DATABASE_URL_RESOLUTION_FAILED'); },
      connect: async function () { throw failClosedError(error.code || 'DATABASE_URL_RESOLUTION_FAILED'); },
      end: async function () {}
    };
  }
  if (!resolution.configured) {
    return {
      configured: false,
      reason: 'DATABASE_URL_MISSING',
      query: async function () { throw failClosedError('DATABASE_URL_MISSING'); },
      connect: async function () { throw failClosedError('DATABASE_URL_MISSING'); },
      end: async function () {}
    };
  }
  var url = resolution.url;
  var production = String(env.NODE_ENV || '').toLowerCase() === 'production';
  if (production && String(env.PG_SSL || '').toLowerCase() !== 'true') {
    return {
      configured: false,
      reason: 'PG_SSL_REQUIRED_IN_PRODUCTION',
      query: async function () { throw failClosedError('PG_SSL_REQUIRED_IN_PRODUCTION'); },
      connect: async function () { throw failClosedError('PG_SSL_REQUIRED_IN_PRODUCTION'); },
      end: async function () {}
    };
  }
  if (production && String(env.PG_SSL_REJECT_UNAUTHORIZED || 'true').toLowerCase() === 'false') {
    return {
      configured: false,
      reason: 'PG_SSL_CERT_VALIDATION_REQUIRED_IN_PRODUCTION',
      query: async function () { throw failClosedError('PG_SSL_CERT_VALIDATION_REQUIRED_IN_PRODUCTION'); },
      connect: async function () { throw failClosedError('PG_SSL_CERT_VALIDATION_REQUIRED_IN_PRODUCTION'); },
      end: async function () {}
    };
  }
  if (!Pool) {
    return {
      configured: false,
      reason: 'PG_DRIVER_NOT_INSTALLED',
      query: async function () { throw failClosedError('PG_DRIVER_NOT_INSTALLED'); },
      connect: async function () { throw failClosedError('PG_DRIVER_NOT_INSTALLED'); },
      end: async function () {}
    };
  }

  var pool = new Pool({
    connectionString: url,
    max: Number(env.PG_POOL_MAX || 10),
    idleTimeoutMillis: Number(env.PG_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(env.PG_CONNECTION_TIMEOUT_MS || 5000),
    ssl: env.PG_SSL === 'true'
      ? { rejectUnauthorized: env.PG_SSL_REJECT_UNAUTHORIZED !== 'false' }
      : undefined
  });

  pool.on('error', function (err) {
    logError('database_pool_error', {
      code: err && err.code ? String(err.code) : undefined,
      message: err && err.message ? String(err.message) : String(err)
    });
  });

  return {
    configured: true,
    pool: pool,
    urlConfigured: true,
    query: function (text, params) { return pool.query(text, params); },
    connect: function () { return pool.connect(); },
    end: function () { return pool.end(); }
  };
}

function createServicePool(env) {
  env = env || process.env;
  var serviceUrl = readSecretEnvValue(env, 'DATABASE_SERVICE_URL');
  if (!serviceUrl) return createPool(env);
  return createPool(Object.assign({}, env, { DATABASE_URL: serviceUrl, DATABASE_URL_FILE: '' }));
}

/**
 * Dedicated worker database boundary.
 * Production must provide DATABASE_WORKER_URL explicitly; there is no
 * fallback to DATABASE_URL/DATABASE_SERVICE_URL because doing so can silently
 * run the worker with an API or migration credential.
 */
function createWorkerPool(env) {
  env = env || process.env;
  var workerResolution;
  try { workerResolution = resolveDatabaseUrl(env, 'DATABASE_WORKER_URL'); }
  catch (error) {
    return {
      configured: false,
      reason: error.code || 'DATABASE_WORKER_URL_RESOLUTION_FAILED',
      query: async function () { throw failClosedError(error.code || 'DATABASE_WORKER_URL_RESOLUTION_FAILED'); },
      connect: async function () { throw failClosedError(error.code || 'DATABASE_WORKER_URL_RESOLUTION_FAILED'); },
      end: async function () {}
    };
  }
  if (!workerResolution.configured) {
    return {
      configured: false,
      reason: 'DATABASE_WORKER_URL_MISSING',
      query: async function () { throw failClosedError('DATABASE_WORKER_URL_MISSING'); },
      connect: async function () { throw failClosedError('DATABASE_WORKER_URL_MISSING'); },
      end: async function () {}
    };
  }
  return createPool(Object.assign({}, env, { DATABASE_URL: workerResolution.url, DATABASE_URL_FILE: '' }));
}

async function requireLiveConnection(db) {
  if (!db || !db.configured || !db.pool) {
    throw failClosedError(db && db.reason ? db.reason : 'DATABASE_NOT_CONFIGURED');
  }
  await db.query('SELECT 1');
  return db;
}

module.exports = { createPool, createServicePool, createWorkerPool, loadPg, requireLiveConnection, resolveDatabaseUrl, readSecretEnvValue };
