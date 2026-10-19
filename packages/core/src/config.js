/**
 * Server + client config loader from process.env (server) — no secrets in repo.
 */
'use strict';

const { resolveAiPolicy } = require('../../ai-boundary/src/aiPolicy');
const { tryResolveDatabaseUrl } = require('../../db/src/databaseUrl');

function loadServerConfig(env) {
  env = env || process.env;
  const aiPolicy = resolveAiPolicy(env);
  const database = tryResolveDatabaseUrl(env, 'DATABASE_URL');
  return Object.freeze({
    nodeEnv: env.NODE_ENV || 'development',
    productionHold: String(env.PRODUCTION_HOLD || 'true').toLowerCase() !== 'false',
    apiPort: Number(env.API_PORT || 8080),
    workerIntervalMs: Number(env.WORKER_INTERVAL_MS || 5000),
    aiPort: Number(env.AI_PORT || 8081),
    aiUpstreamUrl: String(env.FIBEROS_AI_INFERENCE_URL || env.AI_UPSTREAM_URL || '').trim(),
    aiEnabled: aiPolicy.aiEnabled,
    aiEnablementConflict: aiPolicy.conflict,
    realityGateMaxMeters: Number(env.REALITY_GATE_MAX_METERS || 50),
    photoMaxAgeSeconds: Number(env.PHOTO_MAX_AGE_SECONDS || 900),
    corsOrigin: env.CORS_ORIGIN || '',
    databaseUrlConfigured: database.ok && database.resolution.configured,
    databaseUrlSource: database.ok ? database.resolution.source : 'INVALID',
    serviceDatabaseConfigured: !!(env.DATABASE_SERVICE_URL || env.DATABASE_SERVICE_URL_FILE || (database.ok && database.resolution.configured)),
    aiBindHost: env.AI_BIND_HOST || '127.0.0.1'
  });
}

module.exports = { loadServerConfig };
