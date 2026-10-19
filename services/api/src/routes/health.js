'use strict';

function handleHealth(runtimeGate, cfg, db, securityConfigGate, otelStatus) {
  const gate = runtimeGate || {
    status: 'BLOCKED_PRECONDITION',
    productionReady: false,
    productionHold: true,
    reason: 'RUNTIME_GATE_NOT_INITIALIZED',
    checks: []
  };

  // Public health is an unauthenticated network boundary. Keep it limited to
  // liveness/readiness state and non-sensitive service metadata. Detailed
  // database roles, server versions, PostGIS versions, security configuration
  // failures, runtime check internals, and environment names are deliberately
  // withheld to avoid turning /health into a reconnaissance oracle.
  return {
    statusCode: gate.runtimeVerified ? 200 : 503,
    body: {
      ok: gate.runtimeVerified === true,
      service: 'fiberos-api',
      status: gate.status,
      operationalRuntimeVerified: gate.runtimeVerified === true,
      productionReady: gate.productionReady === true,
      productionHold: gate.productionHold,
      time: new Date().toISOString(),
      ...(otelStatus && otelStatus.publicStatus
        ? { openTelemetry: otelStatus.publicStatus }
        : {})
    }
  };
}

module.exports = { handleHealth };
