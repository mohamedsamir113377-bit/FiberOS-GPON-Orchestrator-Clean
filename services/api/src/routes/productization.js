'use strict';
const P = require('../productization');
const { requireVerifiedPrincipal, requireAnyRole } = require('../requireAuth');
const { publicError } = require('../../../../packages/security/src/errorBoundary');
const OI = require('../operationsIntelligence');

function fail(e) {
  if (e instanceof TypeError || e instanceof RangeError) {
    const out = publicError(Object.assign(e, { statusCode: e.statusCode || 400 }));
    return out;
  }
  return publicError(e);
}

async function run(fn) {
  try { return { status: 200, body: { ok: true, ...await fn() } }; }
  catch (e) { return fail(e); }
}

async function handleProductization(req, res, ctx) {
  const { method, path, body, principal, db, send } = ctx;
  if (method === 'GET' && path === '/v1/gis/fleet') {
    const auth = requireVerifiedPrincipal(principal, process.env);
    if (!auth.ok) return send(res, auth.status, auth.body);
    const g = requireAnyRole(principal, ['call_center','ops_manager','area_supervisor','dispatcher','exec','sysadmin']);
    if (!g.ok) return send(res, g.status, g.body);
    const out = await run(async () => ({ fleet: await P.listFleet(db, principal), authority: 'DATABASE_BACKED_CURRENT_POSITION' }));
    return send(res, out.status, out.body);
  }
  if (method === 'GET' && path === '/v1/gis/network-twin') {
    const auth = requireVerifiedPrincipal(principal, process.env);
    if (!auth.ok) return send(res, auth.status, auth.body);
    const g = requireAnyRole(principal, ['ops_manager','area_supervisor','dispatcher','exec','sysadmin']);
    if (!g.ok) return send(res, g.status, g.body);
    const out = await run(async () => await P.networkTwin(db, principal, { limit: new URL(req.url, 'http://localhost').searchParams.get('limit') }));
    return send(res, out.status, out.body);
  }
  if (method === 'POST' && path === '/v1/gis/twin/impact') {
    const auth = requireVerifiedPrincipal(principal, process.env);
    if (!auth.ok) return send(res, auth.status, auth.body);
    const g = requireAnyRole(principal, ['ops_manager','area_supervisor','dispatcher','exec','sysadmin']);
    if (!g.ok) return send(res, g.status, g.body);
    const out = await run(async () => await P.twinImpact(db, principal, body));
    return send(res, out.status, out.body);
  }
  if (method === 'GET' && path.startsWith('/v1/gis/twin/capacity/')) {
    const auth = requireVerifiedPrincipal(principal, process.env);
    if (!auth.ok) return send(res, auth.status, auth.body);
    const g = requireAnyRole(principal, ['ops_manager','area_supervisor','dispatcher','exec','sysadmin','qc']);
    if (!g.ok) return send(res, g.status, g.body);
    const assetId = path.split('/').pop();
    const out = await run(async () => await P.twinCapacity(db, principal, assetId));
    return send(res, out.status, out.body);
  }
  if (method === 'POST' && path === '/v1/gis/nearest-technicians') {
    const auth = requireVerifiedPrincipal(principal, process.env);
    if (!auth.ok) return send(res, auth.status, auth.body);
    const g = requireAnyRole(principal, ['ops_manager','area_supervisor','dispatcher','exec','sysadmin']);
    if (!g.ok) return send(res, g.status, g.body);
    const out = await run(async () => await P.nearestTechnicians(db, principal, body));
    return send(res, out.status, out.body);
  }
  if (method === 'POST' && path === '/v1/gis/technician-density-cluster') {
    const a = requireVerifiedPrincipal(principal, process.env);
    if (!a.ok) return send(res, a.status, a.body);
    const g = requireAnyRole(principal, ['call_center','ops_manager','area_supervisor','dispatcher','exec','sysadmin']);
    if (!g.ok) return send(res, g.status, g.body);
    try {
      const out = await run(async () => await P.technicianDensityCluster(db, principal, body));
      return send(res, 200, { ok: true, ...out });
    } catch (e) {
      return send(res, e.statusCode || 400, { ok: false, error: e.code || e.message });
    }
  }

  if (method === 'POST' && path === '/v1/gis/snap-to-plant') {
    const a = requireVerifiedPrincipal(principal, process.env);
    if (!a.ok) return send(res, a.status, a.body);
    const g = requireAnyRole(principal, ['technician','team_lead','ops_manager','area_supervisor','dispatcher','qc','exec','sysadmin']);
    if (!g.ok) return send(res, g.status, g.body);
    try {
      const out = await run(async () => await P.snapPointToPlant(db, principal, body));
      return send(res, 200, { ok: true, ...out });
    } catch (e) {
      return send(res, e.statusCode || 400, { ok: false, error: e.code || e.message });
    }
  }
  if (method === 'POST' && path === '/v1/gis/geotag-region') {
    const a = requireVerifiedPrincipal(principal, process.env);
    if (!a.ok) return send(res, a.status, a.body);
    const g = requireAnyRole(principal, ['call_center','ops_manager','area_supervisor','dispatcher','exec','sysadmin']);
    if (!g.ok) return send(res, g.status, g.body);
    try {
      const out = await run(async () => await P.geotagPointRegion(db, principal, body));
      return send(res, 200, { ok: true, ...out });
    } catch (e) {
      return send(res, e.statusCode || 400, { ok: false, error: e.code || e.message });
    }
  }
  if (method === 'POST' && path === '/v1/gis/assets-between-distances') {
    const a = requireVerifiedPrincipal(principal, process.env);
    if (!a.ok) return send(res, a.status, a.body);
    const g = requireAnyRole(principal, ['call_center','ops_manager','area_supervisor','dispatcher','exec','sysadmin']);
    if (!g.ok) return send(res, g.status, g.body);
    try {
      const out = await run(async () => await P.assetsBetweenDistances(db, principal, body));
      return send(res, 200, { ok: true, ...out });
    } catch (e) {
      return send(res, e.statusCode || 400, { ok: false, error: e.code || e.message });
    }
  }

  if (method === 'POST' && path === '/v1/gis/positions') {
    const auth = requireVerifiedPrincipal(principal, process.env);
    if (!auth.ok) return send(res, auth.status, auth.body);
    const g = requireAnyRole(principal, ['technician','team_lead','dispatcher','ops_manager','area_supervisor','sysadmin']);
    if (!g.ok) return send(res, g.status, g.body);
    const out = await run(async () => ({ position: await P.recordPosition(db, principal, body), authority: 'AUTHENTICATED_CLIENT_DECLARED', trustedTelemetry: false }));
    return send(res, out.status, out.body);
  }
  if (method === 'POST' && path === '/v1/routing/plan') {
    const auth = requireVerifiedPrincipal(principal, process.env);
    if (!auth.ok) return send(res, auth.status, auth.body);
    const g = requireAnyRole(principal, ['call_center','dispatcher','ops_manager','area_supervisor','exec','sysadmin']);
    if (!g.ok) return send(res, g.status, g.body);
    const out = await run(async () => P.planRoute(body));
    return send(res, out.status, out.body);
  }
  if (method === 'POST' && path === '/v1/inventory/adjust') {
    const auth = requireVerifiedPrincipal(principal, process.env);
    if (!auth.ok) return send(res, auth.status, auth.body);
    const g = requireAnyRole(principal, ['warehouse','ops_manager','area_supervisor','exec','sysadmin']);
    if (!g.ok) return send(res, g.status, g.body);
    const out = await run(async () => ({ result: await P.inventoryAdjust(db, principal, body) }));
    return send(res, out.status, out.body);
  }
  if (method === 'POST' && path === '/v1/messaging/enqueue') {
    const auth = requireVerifiedPrincipal(principal, process.env);
    if (!auth.ok) return send(res, auth.status, auth.body);
    const g = requireAnyRole(principal, ['call_center','ops_manager','exec','sysadmin']);
    if (!g.ok) return send(res, g.status, g.body);
    const out = await run(async () => ({ event: await P.enqueueMessage(db, principal, body), delivery: 'NOT_DELIVERED_UNTIL_PROVIDER_WORKER_CONFIRMS' }));
    return send(res, out.status, out.body);
  }
  if (method === 'POST' && path === '/v1/billing/payment-cycle') {
    const auth = requireVerifiedPrincipal(principal, process.env);
    if (!auth.ok) return send(res, auth.status, auth.body);
    const g = requireAnyRole(principal, ['cfo','exec','ops_manager','sysadmin']);
    if (!g.ok) return send(res, g.status, g.body);
    const out = await run(async () => ({ paymentCycle: await OI.startPaymentCycle(db, principal, body) }));
    return send(res, out.status, out.body);
  }
  if (method === 'POST' && path.startsWith('/v1/billing/payment-cycle/') && path.endsWith('/transition')) {
    const auth = requireVerifiedPrincipal(principal, process.env);
    if (!auth.ok) return send(res, auth.status, auth.body);
    const g = requireAnyRole(principal, ['cfo','exec','ops_manager','sysadmin']);
    if (!g.ok) return send(res, g.status, g.body);
    const cycleId = path.split('/')[4];
    const out = await run(async () => ({ paymentCycle: await OI.transitionPaymentCycle(db, principal, cycleId, body) }));
    return send(res, out.status, out.body);
  }
  if (method === 'POST' && path === '/v1/ops/rework-cases') {
    const auth = requireVerifiedPrincipal(principal, process.env);
    if (!auth.ok) return send(res, auth.status, auth.body);
    const g = requireAnyRole(principal, ['qc','ops_manager','area_supervisor','exec','sysadmin']);
    if (!g.ok) return send(res, g.status, g.body);
    const out = await run(async () => ({ reworkCase: await OI.openReworkCase(db, principal, body) }));
    return send(res, out.status, out.body);
  }
  if (method === 'POST' && path.startsWith('/v1/ops/rework-cases/') && path.endsWith('/close')) {
    const auth = requireVerifiedPrincipal(principal, process.env);
    if (!auth.ok) return send(res, auth.status, auth.body);
    const g = requireAnyRole(principal, ['qc','ops_manager','area_supervisor','exec','sysadmin']);
    if (!g.ok) return send(res, g.status, g.body);
    const caseId = path.split('/')[4];
    const out = await run(async () => ({ reworkCase: await OI.closeReworkCase(db, principal, caseId, body) }));
    return send(res, out.status, out.body);
  }
  if (method === 'POST' && path === '/v1/billing/invoices') {
    const auth = requireVerifiedPrincipal(principal, process.env);
    if (!auth.ok) return send(res, auth.status, auth.body);
    const g = requireAnyRole(principal, ['cfo','exec','ops_manager','call_center','sysadmin']);
    if (!g.ok) return send(res, g.status, g.body);
    const out = await run(async () => ({ invoice: await P.createInvoice(db, principal, body) }));
    return send(res, out.status, out.body);
  }
  if (method === 'GET' && path === '/v1/customer/tickets') {
    const auth = requireVerifiedPrincipal(principal, process.env);
    if (!auth.ok) return send(res, auth.status, auth.body);
    const out = await run(async () => ({ tickets: await P.customerTickets(db, principal), authority: 'CUSTOMER_ACCOUNT_SCOPE' }));
    return send(res, out.status, out.body);
  }
  if (method === 'POST' && path === '/v1/gis/corridor-conflict') {
    const a = requireVerifiedPrincipal(principal, process.env);
    if (!a.ok) return send(res, a.status, a.body);
    const g = requireAnyRole(principal, ['ops_manager','area_supervisor','dispatcher','qc','exec','sysadmin']);
    if (!g.ok) return send(res, g.status, g.body);
    try {
      const out = await run(async () => await P.evaluateDigCorridorConflict(db, principal, body));
      return send(res, 200, { ok: true, ...out });
    } catch (e) {
      return send(res, e.statusCode || 400, { ok: false, error: e.code || e.message });
    }
  }
  if (method === 'POST' && path === '/v1/gis/interpolate-along') {
    const a = requireVerifiedPrincipal(principal, process.env);
    if (!a.ok) return send(res, a.status, a.body);
    const g = requireAnyRole(principal, ['technician','team_lead','ops_manager','area_supervisor','qc','exec','sysadmin']);
    if (!g.ok) return send(res, g.status, g.body);
    try {
      const out = await run(async () => await P.interpolateAlongPlant(db, principal, body));
      return send(res, 200, { ok: true, ...out });
    } catch (e) {
      return send(res, e.statusCode || 400, { ok: false, error: e.code || e.message });
    }
  }
  if (method === 'POST' && path === '/v1/gis/locate-between') {
    const a = requireVerifiedPrincipal(principal, process.env);
    if (!a.ok) return send(res, a.status, a.body);
    const g = requireAnyRole(principal, ['technician','team_lead','ops_manager','area_supervisor','qc','exec','sysadmin']);
    if (!g.ok) return send(res, g.status, g.body);
    try {
      const out = await run(async () => await P.locateBetweenOnPlant(db, principal, body));
      return send(res, 200, { ok: true, ...out });
    } catch (e) {
      return send(res, e.statusCode || 400, { ok: false, error: e.code || e.message });
    }
  }
  if (method === 'POST' && path === '/v1/gis/otdr-to-map') {
    const a = requireVerifiedPrincipal(principal, process.env);
    if (!a.ok) return send(res, a.status, a.body);
    const g = requireAnyRole(principal, ['technician','team_lead','ops_manager','area_supervisor','qc','exec','sysadmin']);
    if (!g.ok) return send(res, g.status, g.body);
    try {
      const out = await run(async () => await P.bindOtdrToMap(db, principal, body));
      return send(res, 200, { ok: true, ...out });
    } catch (e) {
      return send(res, e.statusCode || 400, { ok: false, error: e.code || e.message });
    }
  }
  if (method === 'POST' && path === '/v1/gis/topology-integrity-scan') {
    const a = requireVerifiedPrincipal(principal, process.env);
    if (!a.ok) return send(res, a.status, a.body);
    const g = requireAnyRole(principal, ['ops_manager','area_supervisor','qc','exec','sysadmin']);
    if (!g.ok) return send(res, g.status, g.body);
    try {
      const out = await run(async () => await P.runTopologyIntegrityScan(db, principal, body));
      return send(res, 200, { ok: true, ...out });
    } catch (e) {
      return send(res, e.statusCode || 400, { ok: false, error: e.code || e.message });
    }
  }
  if (method === 'POST' && path === '/v1/gis/simplify-segment') {
    const a = requireVerifiedPrincipal(principal, process.env);
    if (!a.ok) return send(res, a.status, a.body);
    const g = requireAnyRole(principal, ['ops_manager','area_supervisor','exec','sysadmin']);
    if (!g.ok) return send(res, g.status, g.body);
    try {
      const out = await run(async () => await P.simplifyPlantSegment(db, principal, body));
      return send(res, 200, { ok: true, ...out });
    } catch (e) {
      return send(res, e.statusCode || 400, { ok: false, error: e.code || e.message });
    }
  }
  if (method === 'POST' && path === '/v1/gis/application-graph-route') {
    const a = requireVerifiedPrincipal(principal, process.env);
    if (!a.ok) return send(res, a.status, a.body);
    const g = requireAnyRole(principal, ['ops_manager','area_supervisor','dispatcher','exec','sysadmin']);
    if (!g.ok) return send(res, g.status, g.body);
    try {
      const out = await run(async () => await P.applicationGraphRoute(db, principal, body));
      return send(res, 200, { ok: true, ...out });
    } catch (e) {
      return send(res, e.statusCode || 400, { ok: false, error: e.code || e.message });
    }
  }

  return null;
}

module.exports = { handleProductization };
