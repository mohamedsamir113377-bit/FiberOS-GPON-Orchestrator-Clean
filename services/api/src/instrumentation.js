'use strict';

function createFiberOsInstrumentations() {
  const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
  const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg');
  return [new HttpInstrumentation(), new PgInstrumentation()];
}

function startOpenTelemetry(env) {
  env = env || process.env;
  const enabled = String(env.FIBEROS_OTEL_ENABLED || 'false').toLowerCase() === 'true';
  if (!enabled) return { enabled: false, started: false, reason: 'OTEL_DISABLED' };

  try {
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const sdk = new NodeSDK({
      serviceName: env.OTEL_SERVICE_NAME || 'fiberos-api',
      instrumentations: createFiberOsInstrumentations()
    });
    sdk.start();
    const shutdown = () => sdk.shutdown().catch(() => undefined);
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    return { enabled: true, started: true };
  } catch (_) {
    if (String(env.FIBEROS_OTEL_FAIL_CLOSED || 'false').toLowerCase() === 'true') {
      throw new Error('OTEL_DEPENDENCIES_UNAVAILABLE');
    }
    return { enabled: true, started: false, reason: 'OTEL_DEPENDENCIES_UNAVAILABLE' };
  }
}

module.exports = { startOpenTelemetry, createFiberOsInstrumentations };
