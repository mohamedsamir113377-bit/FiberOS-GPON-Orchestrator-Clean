'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const routes = read('services/api/src/routes/commercialSurfaces.js');
const policy = read('services/api/src/routeAuthorizationPolicy.js');
const server = read('services/api/src/server.js');
const parity = JSON.parse(read('config/html-feature-parity.json'));
const registry = JSON.parse(read('config/extensions-registry.json'));
const { validateExtensionManifest } = require('../src/routes/commercialSurfaces');

test('commercial surfaces are centrally wired and explicitly authorized', () => {
  for (const route of [
    '/v1/noc/3d/scene',
    '/v1/gis/twin/simulate',
    '/v1/executive/commercial-report',
    '/v1/commercial/cost-calibration',
    '/v1/commercial/cost-calibration/propose',
    '/v1/commercial/cost-calibration/approve',
    '/v1/extensions/registry',
    '/v1/extensions/validate'
  ]) {
    assert.ok(server.includes(route), 'server missing ' + route);
    assert.ok(policy.includes(route), 'authorization policy missing ' + route);
  }
});

test('NOC, simulation, and cost routes cannot be used as capability bypasses', () => {
  assert.match(server, /checkCapabilityRoute/);
  assert.match(server, /handleCommercialSurfaces/);
  assert.match(routes, /requireVerifiedPrincipal/);
  assert.match(routes, /withPrincipal/);
  assert.match(routes, /noProductionWrite:true/);
  assert.match(routes, /syntheticData:false/);
});

test('cost calibration is grounded in persisted contractor measurements and governed approvals', () => {
  assert.match(routes, /contractor_work_measurements/);
  assert.ok(routes.includes("status in (\\'verified\\',\\'approved\\',\\'invoiced\\',\\'paid\\')"));
  assert.match(routes, /engineering_calibrations/);
  assert.ok(routes.includes("\\'PROPOSED\\'"));
  assert.ok(routes.includes("\\'APPROVED\\'"));
  assert.match(routes, /COST_CALIBRATION_VALIDITY_OVERLAP/);
  assert.match(routes, /independentApproval:true/);
});

test('extension registry remains a contract, not a fake marketplace', () => {
  assert.equal(registry.policy.installationEnabled, false);
  assert.deepEqual(registry.extensions, []);
  const valid = validateExtensionManifest({
    packageName: '@fiberos/example',
    packageVersion: '1.0.0',
    capabilities: ['read.network'],
    permissions: ['network.read'],
    tenantScope: 'tenant',
    dependencies: [],
    provenance: { source: 'buyer-approved' },
    signature: null
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.productionInstallAllowed, false);
  const invalid = validateExtensionManifest({ packageName: '@fiberos/bad' });
  assert.equal(invalid.valid, false);
});

test('capability parity now records the executable closure without pretending production certification', () => {
  const byId = new Map(parity.capabilities.map(x => [x.id, x]));
  assert.equal(byId.get('noc3d').status, 'REAL');
  assert.equal(byId.get('db-engine').status, 'ADVISORY');
  assert.equal(byId.get('cost-settings').status, 'REAL');
  assert.equal(byId.get('marketplace').status, 'ADVISORY');
  for (const id of ['noc3d','db-engine','cost-settings','marketplace']) assert.ok(byId.get(id).evidence.length > 0);
});
