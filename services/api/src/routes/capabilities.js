'use strict';
const registry = require('../capabilities/index.cjs');

// Explicit route table: the first literal of every row is the routable surface, which is
// what scripts/verify-capability-parity.js reads, so every declared surface stays provable.
const CAPABILITY_ROUTE_TABLE = [
  ['/v1/capabilities', 'GET', 'catalogue'],
  ['/v1/capabilities/architecture', 'GET', 'architecture'],
  ['/v1/capabilities/theory-guide', 'GET', 'theory-guide'],
  ['/v1/capabilities/ar-scanner', 'GET', 'ar-scanner'],
  ['/v1/capabilities/energy-analytics', 'GET', 'energy-analytics'],
  ['/v1/capabilities/cross-project', 'GET', 'cross-project'],
  ['/v1/capabilities/reputation-index', 'GET', 'reputation-index'],
  ['/v1/capabilities/business-weather', 'GET', 'business-weather'],
  ['/v1/capabilities/enterprise-tm', 'GET', 'enterprise-tm'],
  ['/v1/capabilities/constitution', 'GET', 'constitution'],
  ['/v1/capabilities/self-improve', 'GET', 'self-improve'],
  ['/v1/capabilities/load-test', 'GET', 'load-test'],
];
const TABLE_PATHS = new Set(CAPABILITY_ROUTE_TABLE.map(function (r) { return r[0]; }));

// Fail-closed by construction: without an explicit authorization resolver every request is
// refused, so a misconfigured deployment cannot expose the catalogue anonymously.
function createAuthorizer(resolveActor) {
  if (typeof resolveActor !== 'function') return function () { return false; };
  return function (req) { try { return Boolean(resolveActor(req)); } catch (e) { return false; } };
}

function mount(app, options) {
  if (!app || typeof app.get !== 'function') throw new TypeError('app with .get is required');
  const opts = options || {};
  if (typeof opts.authorize !== 'function') throw new TypeError('options.authorize is required');
  const authorize = opts.authorize;

  app.get('/v1/capabilities', function (req, res) {
    if (!TABLE_PATHS.has('/v1/capabilities')) { res.status(500).json({ error: 'route table drift' }); return; }
    if (!authorize(req)) { res.status(403).json({ error: 'forbidden' }); return; }
    res.status(200).json({ count: registry.IDS.length, capabilities: registry.describe() });
  });

  app.get('/v1/capabilities/:id', function (req, res) {
    if (!authorize(req)) { res.status(403).json({ error: 'forbidden' }); return; }
    const id = req && req.params ? req.params.id : null;
    if (!TABLE_PATHS.has('/v1/capabilities/' + id)) { res.status(404).json({ error: 'unknown capability', id }); return; }
    const mod = registry.get(id);
    if (!mod) { res.status(404).json({ error: 'unknown capability', id }); return; }
    res.status(200).json({ id, exports: Object.keys(mod).filter(function (k) { return typeof mod[k] === 'function'; }).sort() });
  });

  return app;
}
module.exports = { mount, registry, CAPABILITY_ROUTE_TABLE, createAuthorizer };
