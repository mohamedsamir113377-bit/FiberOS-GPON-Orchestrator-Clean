'use strict';

const { permissionsForRole } = require('../../../packages/security/src/authorization');
const { isLabMode } = require('./requireAuth');
const { routeAuthorizationPolicy } = require('./routeAuthorizationPolicy');

const PUBLIC_PATHS = new Set([
  '/health',
  '/v1/meta',
  '/v1/lifecycle/self-test'
]);

function isPublicTracking(path, method) { return String(method||'').toUpperCase()==='GET' && (/^\/v1\/public\/installations\/tracking\/[^/]+$/.test(String(path||'')) || /^\/v1\/public\/faults\/tracking\/[^/]+$/.test(String(path||''))); }

function isProviderWebhook(path, method) {
  return String(method || '').toUpperCase() === 'POST' && String(path || '') === '/v1/call-center/ivr/inbound';
}

function authorizeHttpRequest(principal, { path, method, env } = {}) {
  env = env || process.env;
  const p = String(path || '/');
  const m = String(method || 'GET').toUpperCase();

  if (PUBLIC_PATHS.has(p)) return { ok: true, mode: 'PUBLIC' };
  if (isProviderWebhook(p, m)) return { ok: true, mode: 'PROVIDER_WEBHOOK_AUTH_IN_HANDLER' };
  if (isPublicTracking(p, m)) return { ok: true, mode: 'TOKENIZED_PUBLIC_TRACKING' };
  if (!p.startsWith('/v1/')) return { ok: true, mode: 'NOT_APPLICABLE' };

  const policy = routeAuthorizationPolicy(p, m);
  if (!policy) {
    return {
      ok: false,
      status: 403,
      body: {
        ok: false,
        error: 'ROUTE_AUTHORIZATION_NOT_DECLARED',
        authority: 'CENTRAL_ROUTE_AUTHORIZATION_POLICY',
        method: m,
        path: p
      }
    };
  }

  const allowLabPrincipal = isLabMode(env) && principal && principal.authenticated === true;
  if (!principal || principal.authenticated !== true || (principal.verified !== true && !allowLabPrincipal)) {
    return {
      ok: false,
      status: 401,
      body: { ok: false, error: 'UNAUTHORIZED', authority: 'APPLICATION_AUTHORIZATION_MIDDLEWARE' }
    };
  }

  if (policy.mode === 'HANDLER_AUTHORITY' || policy.mode === 'PROVIDER_WEBHOOK_AUTH_IN_HANDLER') {
    return { ok: true, mode: policy.mode, role: principal.role || null };
  }

  const role = principal.role == null ? '' : String(principal.role).trim();
  const permissions = permissionsForRole(role);
  if (!role || permissions.length === 0) {
    return {
      ok: false,
      status: 403,
      body: {
        ok: false,
        error: 'APPLICATION_ROLE_NOT_AUTHORIZED',
        authority: 'CENTRAL_ROUTE_AUTHORIZATION_POLICY',
        role: role || null,
        path: p,
        method: m
      }
    };
  }

  if (Array.isArray(policy.roles) && policy.roles.length > 0 && !policy.roles.includes(role) && !(role === 'field_tech' && policy.roles.includes('technician'))) {
    return {
      ok: false,
      status: 403,
      body: {
        ok: false,
        error: 'ROUTE_ROLE_NOT_AUTHORIZED',
        authority: 'CENTRAL_ROUTE_AUTHORIZATION_POLICY',
        role,
        path: p,
        method: m
      }
    };
  }

  return {
    ok: true,
    mode: 'EXACT_ROUTE_ROLE_ADMISSION',
    role,
    permissionCount: permissions.length,
    authorizationPolicy: policy.path || policy.pathPattern.toString()
  };
}

module.exports = { authorizeHttpRequest, PUBLIC_PATHS };
