'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handleHealth } = require('../src/routes/health');

test('public health response does not disclose database or environment internals', () => {
  const result = handleHealth(
    {
      status: 'VERIFIED_RUNTIME',
      runtimeVerified: true,
      productionReady: false,
      productionHold: true,
      reason: 'DATABASE_RUNTIME_VERIFIED_PRODUCTION_HOLD_REMAINS_ACTIVE',
      checks: [
        { name: 'database_select_1', status: 'PASS' },
        { name: 'postgresql_major', status: 'PASS', observed: 18 },
        { name: 'postgresql_security_baseline', status: 'PASS', observed: '18.6' }
      ],
      observed: {
        database: 'fiberos',
        role: 'fiberos_runtime',
        serverVersion: '18.6',
        postgisVersion: '3.6.1'
      }
    },
    { nodeEnv: 'production' },
    { configured: true },
    { ok: true },
    { enabled: true, publicStatus: 'ok' }
  );

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.service, 'fiberos-api');
  assert.equal(result.body.openTelemetry, 'ok');
  assert.equal(Object.hasOwn(result.body, 'runtimeChecks'), false);
  assert.equal(Object.hasOwn(result.body, 'databaseRuntime'), false);
  assert.equal(Object.hasOwn(result.body, 'database'), false);
  assert.equal(Object.hasOwn(result.body, 'securityConfigurationValid'), false);
  assert.equal(Object.hasOwn(result.body, 'nodeEnvironment'), false);
  assert.equal(Object.hasOwn(result.body, 'productionHoldReason'), false);
  const disclosurePayload = { ...result.body };
  delete disclosurePayload.time;
  const serializedDisclosurePayload = JSON.stringify(disclosurePayload);
  assert.equal(serializedDisclosurePayload.includes('fiberos_runtime'), false);
  assert.equal(serializedDisclosurePayload.includes('18.6'), false);
});

test('unavailable runtime remains a 503 without exposing the failure reason', () => {
  const result = handleHealth(
    {
      status: 'BLOCKED_PRECONDITION',
      runtimeVerified: false,
      productionReady: false,
      productionHold: true,
      reason: 'PG_DRIVER_NOT_INSTALLED',
      checks: [{ name: 'database_select_1', status: 'FAIL' }]
    },
    { nodeEnv: 'production' },
    { configured: false, reason: 'PG_DRIVER_NOT_INSTALLED' },
    { ok: false, failures: ['INTERNAL_SECURITY_DETAIL'] },
    { enabled: false }
  );

  assert.equal(result.statusCode, 503);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.productionReady, false);
  assert.equal(Object.hasOwn(result.body, 'productionHoldReason'), false);
  assert.equal(JSON.stringify(result.body).includes('PG_DRIVER_NOT_INSTALLED'), false);
  assert.equal(JSON.stringify(result.body).includes('INTERNAL_SECURITY_DETAIL'), false);
});
