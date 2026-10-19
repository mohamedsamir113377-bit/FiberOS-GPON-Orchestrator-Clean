/**
 * Write-path auth policy for FiberOS API.
 *
 * When JWT_SECRET (or SUPABASE_JWT_SECRET) is set:
 *   - mutating routes require Bearer token with verified signature
 *   - principal.verified must be true
 * When JWT_VERIFY=false (lab): an authenticated principal is still required,
 * but the principal may be unverified for explicit lab-only testing.
 * When no secret and JWT_VERIFY not false: mutating routes return 503 AUTH_NOT_CONFIGURED
 */
'use strict';

const { hasAnyRole } = require('../../../packages/security/src/authorization');

function jwtSecret(env) {
  env = env || process.env;
  return env.JWT_SECRET || env.SUPABASE_JWT_SECRET || '';
}

function identityConfigured(env) {
  env = env || process.env;
  const production=String(env.NODE_ENV||'').toLowerCase()==='production';
  if (production) return !!(String(env.OIDC_JWKS_URL||'').trim() && String(env.OIDC_ISSUER||'').trim() && String(env.OIDC_AUDIENCE||'').trim() && String(env.OIDC_JWKS_ALLOWED_HOSTS||'').trim());
  return !!(jwtSecret(env) || String(env.OIDC_JWKS_URL || '').trim());
}

function isLabMode(env) {
  env = env || process.env;
  return String(env.JWT_VERIFY || 'true').toLowerCase() === 'false' &&
    String(env.FIBEROS_LAB_MODE || '').toLowerCase() === 'true' &&
    String(env.NODE_ENV || '').toLowerCase() !== 'production';
}

function requireVerifiedPrincipal(principal, env) {
  env = env || process.env;
  if (isLabMode(env)) {
    if (!principal || !principal.authenticated) {
      return {
        ok: false,
        status: 401,
        body: { ok: false, error: 'UNAUTHORIZED', note: 'Authenticated lab principal required' }
      };
    }
    return { ok: true, mode: 'LAB_UNVERIFIED', principal: principal };
  }
  const configured = identityConfigured(env);
  if (!configured) {
    return {
      ok: false,
      status: 503,
      body: {
        ok: false,
        error: 'AUTH_NOT_CONFIGURED',
        note: 'Set production OIDC_JWKS_URL/OIDC_ISSUER/OIDC_AUDIENCE/OIDC_JWKS_ALLOWED_HOSTS; HMAC is test/lab only'
      }
    };
  }
  if (!principal || !principal.authenticated) {
    return {
      ok: false,
      status: 401,
      body: { ok: false, error: 'UNAUTHORIZED', note: 'Bearer JWT required' }
    };
  }
  if (!principal.verified) {
    return {
      ok: false,
      status: 401,
      body: { ok: false, error: 'JWT_NOT_VERIFIED' }
    };
  }
  if (principal.error) {
    return {
      ok: false,
      status: 401,
      body: { ok: false, error: 'JWT_NOT_VERIFIED' }
    };
  }
  return { ok: true, mode: 'VERIFIED', principal: principal };
}

/** Optional role gate for sensitive transitions */
function requireAnyRole(principal, roles) {
  roles = roles || [];
  if (!roles.length) return { ok: true };
  const role = principal && principal.role;
  const roleName = role == null ? '' : String(role);
  if (!hasAnyRole(principal, roles)) {
    return {
      ok: false,
      status: 403,
      body: {
        ok: false,
        error: 'FORBIDDEN_ROLE',
        role: roleName || null
      }
    };
  }
  return { ok: true };
}

module.exports = { requireVerifiedPrincipal, requireAnyRole, jwtSecret, identityConfigured, isLabMode };
