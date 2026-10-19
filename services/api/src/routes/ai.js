'use strict';
const { requireVerifiedPrincipal, requireAnyRole } = require('../requireAuth');
const { withPrincipal } = require('../../../../packages/db/src/session');
const { buildContext } = require('../../../../packages/sovereign-ai-context/src');
const { advise, isAiEnabled } = require('../../../../packages/web-intelligence-core/src/runtime');

const AI_ROLES = Object.freeze(['technician','team_lead','dispatcher','call_center','ops_manager','area_supervisor','exec','sysadmin','qc']);

async function handleAi(req, res, ctx) {
  const { method, path, body, principal, db, send } = ctx;
  if (method !== 'POST' || path !== '/v1/ai/advise') return null;
  const auth = requireVerifiedPrincipal(principal, process.env);
  if (!auth.ok) return send(res, auth.status, auth.body);
  const role = requireAnyRole(principal, AI_ROLES);
  if (!role.ok) return send(res, role.status, role.body);
  if (!isAiEnabled()) {
    return send(res, 503, { ok:false, error:'AI_DISABLED', authority:'ADVISORY_ONLY', executionAuthorized:false });
  }
  if (!db || !db.configured) return send(res, 503, { ok:false, error:'DB_NOT_CONFIGURED', authority:'DATABASE_BACKED_AI_CONTEXT' });
  const b = body || {};
  if (Object.prototype.hasOwnProperty.call(b, 'tenantId') || (b.context && Object.prototype.hasOwnProperty.call(b.context, 'tenantId'))) {
    return send(res, 400, { ok:false, error:'AI_CONTEXT_TENANT_ID_FORBIDDEN', authority:'POSTGRESQL_RLS_SESSION' });
  }
  try {
    const result = await withPrincipal(db, principal, async client => {
      const context = await buildContext(client, b.contextRequest || {});
      const ai = await advise({ question: b.question, context });
      return { ...ai, contextAuthority: context.sourceAuthority, contextHash: context.contextHash, piiMinimized: true };
    });
    return send(res, 200, result);
  } catch (e) {
    const status = e.statusCode || (/^AI_CONTEXT_/.test(String(e.code || e.message)) ? 400 : 503);
    return send(res, status, { ok:false, error:e.code || 'AI_CONTEXT_BRIDGE_FAILED', authority:'DATABASE_BACKED_AI_CONTEXT', executionAuthorized:false });
  }
}

module.exports = { handleAi };
