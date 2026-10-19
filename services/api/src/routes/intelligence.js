'use strict';
const { requireVerifiedPrincipal, requireAnyRole } = require('../requireAuth');
const { withPrincipal } = require('../../../../packages/db/src/session');
const { buildGraph } = require('../../../../packages/unified-intelligence-graph/src');

const ROLES = Object.freeze(['technician','team_lead','dispatcher','call_center','ops_manager','area_supervisor','exec','sysadmin','qc']);

async function handleIntelligence(req, res, ctx) {
  const { method, path, body, principal, db, send } = ctx;
  if (method !== 'POST' || path !== '/v1/intelligence/graph') return null;
  const auth = requireVerifiedPrincipal(principal, process.env);
  if (!auth.ok) return send(res, auth.status, auth.body);
  const role = requireAnyRole(principal, ROLES);
  if (!role.ok) return send(res, role.status, role.body);
  if (!db || !db.configured) return send(res, 503, { ok:false, error:'DB_NOT_CONFIGURED', authority:'FIBEROS_DATABASE_RLS' });
  const b = body || {};
  if (Object.prototype.hasOwnProperty.call(b, 'tenantId')) return send(res, 400, { ok:false, error:'INTELLIGENCE_GRAPH_TENANT_ID_FORBIDDEN', authority:'POSTGRESQL_RLS_SESSION' });
  const request = b.request || b;
  if (Object.prototype.hasOwnProperty.call(request, 'tenantId')) return send(res, 400, { ok:false, error:'INTELLIGENCE_GRAPH_TENANT_ID_FORBIDDEN', authority:'POSTGRESQL_RLS_SESSION' });
  try {
    const graph = await withPrincipal(db, principal, client => buildGraph(client, request));
    return send(res, 200, graph);
  } catch (e) {
    const status = e.statusCode || (/^INTELLIGENCE_GRAPH_/.test(String(e.code || e.message)) ? 400 : 503);
    return send(res, status, { ok:false, error:e.code || e.message || 'INTELLIGENCE_GRAPH_FAILED', authority:'FIBEROS_DATABASE_RLS', readOnly:true, executionAuthorized:false });
  }
}
module.exports = { handleIntelligence };
