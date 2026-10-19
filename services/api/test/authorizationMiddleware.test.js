'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { authorizeHttpRequest } = require('../src/authorizationMiddleware');

test('public health route bypasses application authorization', () => {
  assert.equal(authorizeHttpRequest(null, { path: '/health', method: 'GET' }).ok, true);
});

test('provider IVR webhook remains authenticated by its handler-specific boundary', () => {
  const out = authorizeHttpRequest(null, { path: '/v1/call-center/ivr/inbound', method: 'POST' });
  assert.equal(out.ok, true);
  assert.equal(out.mode, 'PROVIDER_WEBHOOK_AUTH_IN_HANDLER');
});

test('protected route requires a verified principal before role admission', () => {
  const out = authorizeHttpRequest({ authenticated: true, verified: false, role: 'ops_manager' }, { path: '/v1/dispatch/rank', method: 'POST' });
  assert.equal(out.ok, false);
  assert.equal(out.status, 401);
});

test('recognized application role passes canonical role admission', () => {
  const out = authorizeHttpRequest({ authenticated: true, verified: true, role: 'dispatcher' }, { path: '/v1/dispatch/rank', method: 'POST' });
  assert.equal(out.ok, true);
  assert.equal(out.mode, 'EXACT_ROUTE_ROLE_ADMISSION');
  assert.equal(out.role, 'dispatcher');
  assert.ok(out.permissionCount > 0);
});

test('unknown application role fails closed', () => {
  const out = authorizeHttpRequest({ authenticated: true, verified: true, role: 'unknown_role' }, { path: '/v1/dispatch/rank', method: 'POST' });
  assert.equal(out.ok, false);
  assert.equal(out.status, 403);
  assert.equal(out.body.error, 'APPLICATION_ROLE_NOT_AUTHORIZED');
});

test('customer ticket surface remains principal/tenant-handler scoped', () => {
  const out = authorizeHttpRequest({ authenticated: true, verified: true, role: null }, { path: '/v1/customer/tickets', method: 'GET' });
  assert.equal(out.ok, true);
  assert.equal(out.mode, 'HANDLER_AUTHORITY');
});

test('explicit lab mode may pass an authenticated unverified principal', () => {
  const env = { NODE_ENV: 'test', JWT_VERIFY: 'false', FIBEROS_LAB_MODE: 'true' };
  const out = authorizeHttpRequest(
    { authenticated: true, verified: false, role: 'dispatcher' },
    { path: '/v1/dispatch/rank', method: 'POST', env }
  );
  assert.equal(out.ok, true);
});
