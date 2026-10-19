'use strict';

const { parseCookies } = require('./oidcAuthServer');

function safeMethod(method) { return ['GET', 'HEAD', 'OPTIONS'].includes(String(method || '').toUpperCase()); }

async function getSessionPrincipal(req, oidcServer) {
  if (!oidcServer || !oidcServer.configured) return { authenticated: false, present: false };
  const sessionId = parseCookies(req).fiberos_sid;
  if (!sessionId) return { authenticated: false, present: false };
  const session = await oidcServer.getSession(sessionId);
  if (!session) return { authenticated: false, present: true, error: 'SESSION_INVALID_OR_EXPIRED' };
  return {
    authenticated: true,
    verified: true,
    role: session.role || null,
    sub: session.sub,
    email: session.email || null,
    source: 'OIDC_SESSION',
    sessionId,
    csrfToken: session.csrfToken,
    safeMethod: safeMethod(req.method)
  };
}

function validateSessionMutation(req, sessionPrincipal, env = process.env) {
  if (!sessionPrincipal || sessionPrincipal.source !== 'OIDC_SESSION' || safeMethod(req.method)) return { ok: true };
  const expectedOrigin = String(env.FIBEROS_OPS_WEB_ORIGIN || '').trim();
  if (expectedOrigin) {
    const origin = String(req.headers.origin || '').trim();
    if (origin && origin !== expectedOrigin) return { ok: false, status: 403, body: { ok: false, error: 'CSRF_ORIGIN_REJECTED' } };
  }
  const supplied = String(req.headers['x-fiberos-csrf'] || '');
  if (!supplied || supplied !== String(sessionPrincipal.csrfToken || '')) return { ok: false, status: 403, body: { ok: false, error: 'CSRF_TOKEN_REQUIRED' } };
  return { ok: true };
}

module.exports = { getSessionPrincipal, validateSessionMutation };
