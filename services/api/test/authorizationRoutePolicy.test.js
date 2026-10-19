'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { authorizeHttpRequest } = require('../src/authorizationMiddleware');
const { allProtectedRouteRules, ALL_ROLES } = require('../src/routeAuthorizationPolicy');

function principal(role, verified = true) {
  return { authenticated: true, verified, role, sub: '00000000-0000-0000-0000-000000000001' };
}

test('unknown protected routes fail closed even for valid principals', () => {
  const out = authorizeHttpRequest(principal('ops_manager'), { path: '/v1/not-declared', method: 'GET', env: {} });
  assert.equal(out.ok, false);
  assert.equal(out.status, 403);
  assert.equal(out.body.error, 'ROUTE_AUTHORIZATION_NOT_DECLARED');
});

test('sensitive route rejects a role outside its route contract', () => {
  const out = authorizeHttpRequest(principal('technician'), { path: '/v1/billing/invoices', method: 'POST', env: {} });
  assert.equal(out.ok, false);
  assert.equal(out.status, 403);
  assert.equal(out.body.error, 'ROUTE_ROLE_NOT_AUTHORIZED');
});

test('sensitive route admits a role declared by the route contract', () => {
  const out = authorizeHttpRequest(principal('cfo'), { path: '/v1/billing/invoices', method: 'POST', env: {} });
  assert.equal(out.ok, true);
  assert.equal(out.mode, 'EXACT_ROUTE_ROLE_ADMISSION');
});

test('dynamic customer scope remains explicitly handler-owned', () => {
  const out = authorizeHttpRequest(principal('call_center'), { path: '/v1/customer/tickets', method: 'GET', env: {} });
  assert.equal(out.ok, true);
  assert.equal(out.mode, 'HANDLER_AUTHORITY');
});

test('provider webhook remains a narrow handler-authenticated exception', () => {
  const out = authorizeHttpRequest(null, { path: '/v1/call-center/ivr/inbound', method: 'POST', env: {} });
  assert.equal(out.ok, true);
  assert.equal(out.mode, 'PROVIDER_WEBHOOK_AUTH_IN_HANDLER');
});

test('lab-mode principal is still constrained by route role contract', () => {
  const out = authorizeHttpRequest(principal('technician', false), {
    path: '/v1/billing/invoices',
    method: 'POST',
    env: { JWT_VERIFY: 'false', FIBEROS_LAB_MODE: 'true', NODE_ENV: 'development' }
  });
  assert.equal(out.ok, false);
  assert.equal(out.status, 403);
  assert.equal(out.body.error, 'ROUTE_ROLE_NOT_AUTHORIZED');
});


test('route policy contains no duplicate declarations and only canonical roles', () => {
  const rules = allProtectedRouteRules();
  const keys = rules.map((x) => `${x.method}|${x.path || x.pathPattern}`);
  assert.equal(new Set(keys).size, keys.length);
  const canonical = new Set(ALL_ROLES);
  for (const rule of rules) {
    for (const role of rule.roles || []) assert.equal(canonical.has(role), true, `unknown role ${role}`);
  }
});

test('reality-boundary advisory routes are declared and admit authenticated roles', () => {
  const out = authorizeHttpRequest(principal('ops_manager'), {
    path: '/v1/reality-boundary/optical-assurance',
    method: 'POST',
    env: {}
  });
  assert.equal(out.ok, true);
  assert.equal(out.mode, 'EXACT_ROUTE_ROLE_ADMISSION');
});

test('engineering shared-risk-from-service-paths route is declared', () => {
  const out = authorizeHttpRequest(principal('technician'), {
    path: '/v1/engineering/shared-risk-from-service-paths',
    method: 'POST',
    env: {}
  });
  assert.equal(out.ok, true);
});

test('engineering shared-risk-from-trace-nodes route is declared', () => {
  const out = authorizeHttpRequest(principal('qc'), {
    path: '/v1/engineering/shared-risk-from-trace-nodes',
    method: 'POST',
    env: {}
  });
  assert.equal(out.ok, true);
});

test('shared-risk route uses least-privilege operational roles', () => {
  const rule = allProtectedRouteRules().find(r => r.method === 'POST' && r.path === '/v1/network-intelligence/shared-risk');
  assert.ok(rule);
  assert.deepEqual(rule.roles, ['ops_manager','area_supervisor','dispatcher','exec','sysadmin','qc']);
  const denied = authorizeHttpRequest(principal('technician'), {
    path: '/v1/network-intelligence/shared-risk',
    method: 'POST',
    env: {}
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, 'ROUTE_ROLE_NOT_AUTHORIZED');
});

test('department KPI routes are declared for management and operational read roles', () => {
  const out = authorizeHttpRequest(principal('ops_manager'), {
    path: '/v1/operations/department-kpis/FIELD',
    method: 'GET',
    env: {}
  });
  assert.equal(out.ok, true);

  const denied = authorizeHttpRequest(principal('technician'), {
    path: '/v1/operations/department-kpis/ENGINEERING',
    method: 'GET',
    env: {}
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, 'ROUTE_ROLE_NOT_AUTHORIZED');
});

test('linked shared-risk network-intelligence route is declared', () => {
  const out = authorizeHttpRequest(principal('ops_manager'), {
    path: '/v1/network-intelligence/shared-risk',
    method: 'POST',
    env: {}
  });
  assert.equal(out.ok, true);
});

test('customer portal routes admit customer and deny technician', () => {
  const allowed = authorizeHttpRequest(principal('customer'), {
    path: '/v1/customer-portal/overview',
    method: 'GET',
    env: {}
  });
  assert.equal(allowed.ok, true);

  const denied = authorizeHttpRequest(principal('technician'), {
    path: '/v1/customer-portal/overview',
    method: 'GET',
    env: {}
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.body.error, 'ROUTE_ROLE_NOT_AUTHORIZED');
});

test('contractor-commercial routes admit contractor and deny technician', () => {
  const allowed = authorizeHttpRequest(principal('contractor'), {
    path: '/v1/contractor-commercial/work-packages',
    method: 'GET',
    env: {}
  });
  assert.equal(allowed.ok, true);

  const denied = authorizeHttpRequest(principal('technician'), {
    path: '/v1/contractor-commercial/measurements',
    method: 'POST',
    env: {}
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.body.error, 'ROUTE_ROLE_NOT_AUTHORIZED');
});
