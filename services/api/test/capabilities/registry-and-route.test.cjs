'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../../src/capabilities/index.cjs');
const { mount, CAPABILITY_ROUTE_TABLE, createAuthorizer } = require('../../src/routes/capabilities.js');

const EXPECTED = ['architecture','theory-guide','ar-scanner','energy-analytics','cross-project',
  'reputation-index','business-weather','enterprise-tm','constitution','self-improve','load-test'];

function fakeApp() { const routes = []; return { routes, get(p, h) { routes.push([p, h]); return this; } }; }
function call(app, path, req) {
  const e = app.routes.find((r) => r[0] === path);
  if (!e) throw new Error('route not mounted: ' + path);
  let code = null, body = null;
  e[1](req, { status(c) { code = c; return this; }, json(b) { body = b; return this; } });
  return { code, body };
}

test('the registry exposes exactly the 11 capability ids', () => {
  assert.deepEqual(registry.IDS, EXPECTED.slice().sort());
  for (const id of EXPECTED) assert.ok(registry.get(id), 'missing ' + id);
  assert.equal(registry.get('nope'), null);
});
test('every capability id has a declared /v1 route surface', () => {
  const paths = new Set(CAPABILITY_ROUTE_TABLE.map((r) => r[0]));
  for (const id of EXPECTED) assert.ok(paths.has('/v1/capabilities/' + id), 'no surface for ' + id);
});
test('the catalogue route requires an authorization hook', () => {
  assert.throws(() => mount(fakeApp(), {}), /options.authorize is required/);
});
test('a resolver that throws still fails closed', () => {
  const a = createAuthorizer(() => { throw new Error('boom'); });
  assert.equal(a({}), false);
  assert.equal(createAuthorizer(null)({}), false);
});
test('an unauthorized caller gets 403 and never sees the catalogue', () => {
  const app = mount(fakeApp(), { authorize: () => false });
  assert.equal(call(app, '/v1/capabilities', {}).code, 403);
  assert.equal(call(app, '/v1/capabilities/:id', { params: { id: 'load-test' } }).code, 403);
});
test('an authorized caller gets 11 capabilities, unknown ids are 404', () => {
  const app = mount(fakeApp(), { authorize: () => true });
  const r = call(app, '/v1/capabilities', {});
  assert.equal(r.code, 200);
  assert.equal(r.body.count, 11);
  assert.deepEqual(r.body.capabilities.map((c) => c.id), EXPECTED.slice().sort());
  assert.equal(call(app, '/v1/capabilities/:id', { params: { id: 'ghost' } }).code, 404);
  const ok = call(app, '/v1/capabilities/:id', { params: { id: 'enterprise-tm' } });
  assert.equal(ok.code, 200);
  for (const fn of ['append', 'asOf', 'verifyChain']) assert.ok(ok.body.exports.includes(fn));
});
