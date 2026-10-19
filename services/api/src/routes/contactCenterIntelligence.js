'use strict';
const { requireVerifiedPrincipal, requireAnyRole } = require('../requireAuth');
const { withPrincipal } = require('../../../../packages/db/src/session');
const { buildContactIntelligence } = require('../../../../packages/contact-center-intelligence/src');
const { health } = require('../../../../packages/sovereign-contact-center/src/runtime');

const ROLES = Object.freeze(['call_center','ops_manager','area_supervisor','exec','sysadmin']);

async function handleContactCenterIntelligence(req, res, ctx) {
  const { method, path, body, principal, db, send } = ctx;
  if (path !== '/v1/contact-center/intelligence' && path !== '/v1/contact-center/runtime/status') return null;
  const verified = requireVerifiedPrincipal(principal, process.env);
  if (!verified.ok) return send(res, verified.status, verified.body);
  const role = requireAnyRole(principal, ROLES);
  if (!role.ok) return send(res, role.status, role.body);

  if (path === '/v1/contact-center/runtime/status') {
    if (method !== 'GET') return null;
    try {
      const result = await health();
      return send(res, 200, { ok:true, ...result, runtime:'ASTERISK_ARI_INTERNAL', readOnly:true, executionAuthorized:false });
    } catch (e) {
      return send(res, 503, { ok:false, error:e.code || 'CONTACT_CENTER_RUNTIME_UNAVAILABLE', authority:'FIBEROS_POLICY', runtime:'ASTERISK_ARI_INTERNAL', readOnly:true, executionAuthorized:false });
    }
  }

  if (method !== 'POST') return null;
  if (!db || !db.configured) return send(res, 503, {ok:false,error:'DB_NOT_CONFIGURED',authority:'FIBEROS_DATABASE_RLS'});
  const b = body || {};
  if (Object.prototype.hasOwnProperty.call(b,'tenantId')) return send(res,400,{ok:false,error:'CONTACT_INTELLIGENCE_TENANT_ID_FORBIDDEN',authority:'POSTGRESQL_RLS_SESSION'});
  try {
    const result = await withPrincipal(db, principal, client => buildContactIntelligence(client, b));
    return send(res, 200, result);
  } catch (e) {
    return send(res, e.statusCode || 400, {ok:false,error:e.code || e.message || 'CONTACT_INTELLIGENCE_FAILED',authority:'FIBEROS_DATABASE_RLS',readOnly:true,executionAuthorized:false});
  }
}
module.exports = { handleContactCenterIntelligence };
