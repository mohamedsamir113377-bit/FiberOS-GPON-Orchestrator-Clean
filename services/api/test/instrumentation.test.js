'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFiberOsInstrumentations, startOpenTelemetry } = require('../src/instrumentation');

test('OpenTelemetry remains opt-in by default', () => {
  assert.deepEqual(startOpenTelemetry({}), {
    enabled: false,
    started: false,
    reason: 'OTEL_DISABLED'
  });
});

test('FiberOS enables only HTTP and PostgreSQL telemetry instrumentations', () => {
  const names = createFiberOsInstrumentations()
    .map((instrumentation) => instrumentation.instrumentationName)
    .sort();
  assert.deepEqual(names, [
    '@opentelemetry/instrumentation-http',
    '@opentelemetry/instrumentation-pg'
  ]);
});
