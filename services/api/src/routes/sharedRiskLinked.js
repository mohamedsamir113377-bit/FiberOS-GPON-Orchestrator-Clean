'use strict';

/**
 * Linked shared-risk analysis against authoritative service-path hops under RLS.
 * Requires DB. Client-supplied tenantId is forbidden.
 */

const { requireVerifiedPrincipal, requireAnyRole } = require('../requireAuth');
const { withPrincipal } = require('../../../../packages/db/src/session');
const {
  analyseLinkedSharedRisk
} = require('../../../../packages/engineering/src/sharedRiskLinkedAnalysis');

const ROLES = Object.freeze([
  'technician',
  'team_lead',
  'dispatcher',
  'call_center',
  'ops_manager',
  'area_supervisor',
  'exec',
  'sysadmin',
  'qc',
  'field_tech'
]);

async function handleSharedRiskLinked(req, res, ctx) {
  const { method, path, body, principal, db, send } = ctx;
  if (method !== 'POST' || path !== '/v1/network-intelligence/shared-risk') return null;

  const auth = requireVerifiedPrincipal(principal, process.env);
  if (!auth.ok) return send(res, auth.status, auth.body);
  const role = requireAnyRole(principal, ROLES);
  if (!role.ok) return send(res, role.status, role.body);

  if (!db || !db.configured) {
    return send(res, 503, {
      ok: false,
      error: 'DB_NOT_CONFIGURED',
      authority: 'FIBEROS_DATABASE_RLS'
    });
  }

  const b = body || {};
  if (Object.prototype.hasOwnProperty.call(b, 'tenantId') || Object.prototype.hasOwnProperty.call(b, 'tenant_id')) {
    return send(res, 400, {
      ok: false,
      error: 'SHARED_RISK_TENANT_ID_FORBIDDEN',
      authority: 'POSTGRESQL_RLS_SESSION'
    });
  }

  try {
    const report = await withPrincipal(db, principal, (client) =>
      analyseLinkedSharedRisk(client, {
        serviceId: b.serviceId || null,
        assetId: b.assetId || null,
        whatIfResourceId: b.whatIfResourceId || null,
        topN: b.topN,
        maxPaths: b.maxPaths,
        states: b.states
      })
    );
    return send(res, 200, {
      ok: true,
      authority: 'POSTGRESQL_RLS_SESSION',
      executionAuthorized: true,
      readOnly: true,
      result: report
    });
  } catch (e) {
    const status = e.statusCode || (/^SHARED_RISK_/.test(String(e.code || e.message)) ? 400 : 503);
    return send(res, status, {
      ok: false,
      error: e.code || e.message || 'SHARED_RISK_LINKED_FAILED',
      authority: 'FIBEROS_DATABASE_RLS',
      readOnly: true,
      executionAuthorized: false
    });
  }
}

module.exports = { handleSharedRiskLinked };
