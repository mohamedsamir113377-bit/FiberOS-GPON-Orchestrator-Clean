'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');

test('fttx engineering routes are registered in auth policy and server', () => {
  const policy = fs.readFileSync(path.join(ROOT, 'services/api/src/routeAuthorizationPolicy.js'), 'utf8');
  const server = fs.readFileSync(path.join(ROOT, 'services/api/src/server.js'), 'utf8');
  const route = fs.readFileSync(path.join(ROOT, 'services/api/src/routes/fttxEngineering.js'), 'utf8');
  assert.match(policy, /fttx-engineering/);
  assert.ok(policy.includes('fttx-engineering/catalog'));
  assert.ok(policy.includes('as-built/records'));
  assert.match(server, /handleFttxEngineering/);
  assert.match(route, /evaluateOdnPowerBudget/);
  assert.match(route, /composeHierarchicalLabel/);
  assert.match(route, /buildAsBuiltDeviation/);
});

test('pure route evaluations work without database', async () => {
  const { handleFttxEngineering } = require(path.join(ROOT, 'services/api/src/routes/fttxEngineering.js'));
  const principal = { sub: 'user-1', role: 'ops_manager', authenticated: true, verified: true };
  const captured = [];
  const send = (res, status, body) => {
    captured.push({ status, body });
    return body;
  };
  await handleFttxEngineering({}, {}, {
    method: 'POST',
    path: '/v1/fttx-engineering/evaluate/bend-radius',
    principal,
    db: null,
    send,
    body: { cableDiameterMm: 10, proposedRadiusMm: 100, condition: 'DYNAMIC' }
  });
  assert.equal(captured[0].status, 200);
  assert.equal(captured[0].body.evaluation.accepted, false);

  captured.length = 0;
  await handleFttxEngineering({}, {}, {
    method: 'POST',
    path: '/v1/fttx-engineering/evaluate/odn-budget',
    principal,
    db: null,
    send,
    body: {
      odnClass: 'C',
      lengthKm: 20,
      fiberAttenuationDbPerKm: 0.4,
      splices: 15,
      spliceLossDb: 0.1,
      connectors: 4,
      connectorLossDb: 0.35,
      splitterLossDb: 17.1,
      designMarginDb: 1,
      maintenanceMarginDb: 1,
      availableBudgetDb: 30
    }
  });
  assert.equal(captured[0].status, 200);
  assert.equal(captured[0].body.ok, true);

  captured.length = 0;
  await handleFttxEngineering({}, {}, {
    method: 'POST',
    path: '/v1/fttx-engineering/label/compose',
    principal,
    db: null,
    send,
    body: {
      parts: { REGION: 'R1', AREA: 'A1', BUILDING: 'B1', RACK: 'RK1', PANEL: 'PN1', PORT: '01' }
    }
  });
  assert.equal(captured[0].body.label.code, 'R1-A1-B1-RK1-PN1-01');
});
