'use strict';
/**
 * Server-side tenant boundary helpers for mutating routes.
 * Client-supplied tenantId is never authoritative.
 * productionClaim: PROHIBITED — library only; RLS remains final authority at DB.
 */

function rejectClientTenantAuthority(body) {
  body = body || {};
  if (Object.prototype.hasOwnProperty.call(body, 'tenantId') ||
      Object.prototype.hasOwnProperty.call(body, 'tenant_id')) {
    return {
      ok: false,
      status: 400,
      body: {
        ok: false,
        error: 'CLIENT_TENANT_AUTHORITY_FORBIDDEN',
        note: 'tenant is derived from authenticated session / resource ownership, not request body'
      }
    };
  }
  return { ok: true };
}

function assertPrincipalForWrite(principal) {
  if (!principal || !principal.authenticated) {
    return {
      ok: false,
      status: 401,
      body: { ok: false, error: 'UNAUTHORIZED' }
    };
  }
  if (principal.verified === false && principal.mode !== 'LAB_UNVERIFIED') {
    return {
      ok: false,
      status: 401,
      body: { ok: false, error: 'JWT_NOT_VERIFIED' }
    };
  }
  return { ok: true };
}

/** Mark that a write path established an explicit boundary check */
function boundaryOk(extra) {
  return Object.assign({ ok: true, hasBoundary: true, authority: 'SERVER_DERIVED' }, extra || {});
}

module.exports = {
  rejectClientTenantAuthority,
  assertPrincipalForWrite,
  boundaryOk
};
