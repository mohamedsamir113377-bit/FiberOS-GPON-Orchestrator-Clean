'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const a = require('../src/index');

test('OWASP API Top 10 (2023) is complete with ten entries', () => {
  assert.equal(a.OWASP_API_TOP10_2023.length, 10);
  assert.equal(a.OWASP_API_TOP10_2023[0].key, 'BOLA');
});

test('checkObjectLevelAuthorization blocks cross-tenant access', () => {
  const r = a.checkObjectLevelAuthorization({ callerTenantId: 'T1', callerScopes: [], resource: { tenantId: 'T2' } });
  assert.equal(r.allowed, false);
  assert.equal(r.threat, 'API1');
  const ok = a.checkObjectLevelAuthorization({ callerTenantId: 'T1', callerScopes: ['read'], resource: { tenantId: 'T1', requiredScopes: ['read'] } });
  assert.equal(ok.allowed, true);
});

test('checkFunctionLevelAuthorization enforces required roles', () => {
  const r = a.checkFunctionLevelAuthorization({ callerRoles: ['technician'], requiredRoles: ['admin'] });
  assert.equal(r.allowed, false);
  assert.equal(r.threat, 'API5');
});

test('checkResourceConsumption enforces the limit', () => {
  assert.equal(a.checkResourceConsumption({ requested: 5, limit: 10 }).allowed, true);
  assert.equal(a.checkResourceConsumption({ requested: 20, limit: 10 }).threat, 'API4');
});

test('checkOutboundTarget blocks SSRF to private ranges and off-allowlist hosts', () => {
  assert.equal(a.checkOutboundTarget({ url: 'http://127.0.0.1/x' }).threat, 'API7');
  assert.equal(a.checkOutboundTarget({ url: 'https://evil.example/x', allowlist: ['api.example'] }).allowed, false);
  assert.equal(a.checkOutboundTarget({ url: 'https://api.example/x', allowlist: ['api.example'] }).allowed, true);
});

test('tokenBindingPolicy requires proof when sender-constrained', () => {
  assert.equal(a.tokenBindingPolicy({ senderConstrained: true, proofPresent: false }).accepted, false);
  assert.equal(a.tokenBindingPolicy({ senderConstrained: true, proofPresent: true }).accepted, true);
  assert.equal(a.classifyThreat('SSRF').id, 'API7');
});
